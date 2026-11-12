// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-price purchase orders settled in one configured test ERC-20.
contract StockPactEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant ORDER_TIMEOUT = 30 days;
    uint64 public constant DISPUTE_TIMEOUT = 30 days;
    uint64 public constant MAX_AUTHORIZATION_AGE = 15 minutes;

    bytes32 public constant RELEASE_TYPEHASH = keccak256(
        "DeliveryRelease(bytes32 orderId,bytes32 nonce,address supplier,uint64 previousQuantity,uint64 quantity,uint256 amount,uint64 expiresAt)"
    );

    struct Order {
        address buyer;
        address supplier;
        address driver;
        uint64 quantity;
        uint64 acceptedQuantity;
        uint64 refundAvailableAt;
        uint64 disputedAt;
        uint256 funded;
        uint256 released;
        uint256 refunded;
        bool closed;
    }

    struct DeliveryRelease {
        bytes32 orderId;
        bytes32 nonce;
        address supplier;
        uint64 previousQuantity;
        uint64 quantity;
        uint256 amount;
        uint64 expiresAt;
    }

    IERC20 public immutable token;
    address public immutable attestor;
    address public immutable resolver;
    uint256 public immutable unitsPerCent;
    mapping(bytes32 => Order) public orders;
    mapping(bytes32 => mapping(bytes32 => bool)) public unavailableNonces;

    event Funded(bytes32 indexed orderId, address indexed buyer, address indexed supplier, uint256 amount, uint64 quantity);
    event DriverSet(bytes32 indexed orderId, address indexed driver);
    event AuthorizationCancelled(bytes32 indexed orderId, bytes32 indexed nonce);
    event Released(bytes32 indexed orderId, bytes32 indexed nonce, address indexed supplier, address submittedBy,
        uint64 previousQuantity, uint64 quantity, uint256 amount);
    event Disputed(bytes32 indexed orderId, address indexed openedBy);
    event Closed(bytes32 indexed orderId, uint256 paidToSupplier, uint256 refundedToBuyer);

    error InvalidTerms();
    error Unauthorized();
    error UnavailableOrder();
    error InvalidAuthorization();
    error InvalidTokenTransfer();

    constructor(address settlementToken, address platformAttestor, address disputeResolver) EIP712("StockPact Escrow", "1") {
        if (settlementToken == address(0) || platformAttestor == address(0) || disputeResolver == address(0)) revert InvalidTerms();
        uint8 decimals = IERC20Metadata(settlementToken).decimals();
        if (decimals < 2 || decimals > 18) revert InvalidTerms();
        token = IERC20(settlementToken);
        attestor = platformAttestor;
        resolver = disputeResolver;
        unitsPerCent = 10 ** (decimals - 2);
    }

    function orderReference(bytes32 orderKey, address buyer) public pure returns (bytes32) {
        return keccak256(abi.encode(orderKey, buyer));
    }

    function fund(bytes32 orderKey, address supplier, uint64 quantity, uint256 amount) external nonReentrant {
        if (orderKey == bytes32(0) || supplier == address(0) || supplier == msg.sender || quantity == 0 ||
            amount % unitsPerCent != 0 || amount / unitsPerCent < quantity) revert InvalidTerms();
        bytes32 orderId = orderReference(orderKey, msg.sender);
        Order storage order = orders[orderId];
        if (order.buyer != address(0)) revert UnavailableOrder();

        order.buyer = msg.sender;
        order.supplier = supplier;
        order.quantity = quantity;
        order.funded = amount;
        order.refundAvailableAt = uint64(block.timestamp) + ORDER_TIMEOUT;
        uint256 initialBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != initialBalance + amount) revert InvalidTokenTransfer();
        emit Funded(orderId, msg.sender, supplier, amount, quantity);
    }

    function setDriver(bytes32 orderId, address driver) external {
        Order storage order = activeOrder(orderId);
        if (msg.sender != order.supplier || driver == order.buyer) revert Unauthorized();
        order.driver = driver;
        emit DriverSet(orderId, driver);
    }

    function cancelAuthorization(bytes32 orderId, bytes32 nonce) external {
        Order storage order = activeOrder(orderId);
        if (msg.sender != order.buyer && msg.sender != attestor) revert Unauthorized();
        if (unavailableNonces[orderId][nonce]) revert InvalidAuthorization();
        unavailableNonces[orderId][nonce] = true;
        emit AuthorizationCancelled(orderId, nonce);
    }

    function release(DeliveryRelease calldata authorization, bytes calldata buyerSignature, bytes calldata platformSignature)
        external nonReentrant
    {
        Order storage order = activeOrder(authorization.orderId);
        if (order.disputedAt != 0 || block.timestamp >= order.refundAvailableAt) revert UnavailableOrder();
        if (msg.sender != order.supplier && msg.sender != order.driver) revert Unauthorized();
        if (authorization.supplier != order.supplier || authorization.nonce == bytes32(0) ||
            unavailableNonces[authorization.orderId][authorization.nonce] ||
            authorization.expiresAt <= block.timestamp || authorization.expiresAt > block.timestamp + MAX_AUTHORIZATION_AGE ||
            authorization.previousQuantity != order.acceptedQuantity || authorization.quantity == 0 ||
            authorization.quantity > order.quantity - order.acceptedQuantity) revert InvalidAuthorization();

        uint64 nextQuantity = order.acceptedQuantity + authorization.quantity;
        uint256 cumulativeAmount = Math.mulDiv(order.funded / unitsPerCent, nextQuantity, order.quantity) * unitsPerCent;
        if (authorization.amount != cumulativeAmount - order.released) revert InvalidAuthorization();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, authorization)));
        if (!SignatureChecker.isValidSignatureNow(order.buyer, digest, buyerSignature) ||
            !SignatureChecker.isValidSignatureNow(attestor, digest, platformSignature)) revert InvalidAuthorization();

        unavailableNonces[authorization.orderId][authorization.nonce] = true;
        order.acceptedQuantity = nextQuantity;
        order.released = cumulativeAmount;
        if (nextQuantity == order.quantity) order.closed = true;
        token.safeTransfer(order.supplier, authorization.amount);
        emit Released(authorization.orderId, authorization.nonce, order.supplier, msg.sender,
            authorization.previousQuantity, authorization.quantity, authorization.amount);
    }

    function openDispute(bytes32 orderId) external {
        Order storage order = activeOrder(orderId);
        if (msg.sender != order.buyer && msg.sender != order.supplier) revert Unauthorized();
        if (order.disputedAt != 0 || block.timestamp >= order.refundAvailableAt) revert UnavailableOrder();
        order.disputedAt = uint64(block.timestamp);
        emit Disputed(orderId, msg.sender);
    }

    /// @notice The designated resolver may only allocate this disputed order's outstanding balance.
    function resolveDispute(bytes32 orderId, uint256 supplierAward) external nonReentrant {
        Order storage order = activeOrder(orderId);
        if (msg.sender != resolver) revert Unauthorized();
        if (order.disputedAt == 0 || block.timestamp >= order.disputedAt + DISPUTE_TIMEOUT) revert UnavailableOrder();
        if (supplierAward > order.funded - order.released || supplierAward % unitsPerCent != 0) revert InvalidTerms();
        closeOrder(orderId, order, supplierAward);
    }

    function refundExpired(bytes32 orderId) external nonReentrant {
        Order storage order = activeOrder(orderId);
        uint256 eligibleAt = order.disputedAt == 0 ? order.refundAvailableAt : order.disputedAt + DISPUTE_TIMEOUT;
        if (block.timestamp < eligibleAt) revert UnavailableOrder();
        closeOrder(orderId, order, 0);
    }

    function activeOrder(bytes32 orderId) private view returns (Order storage order) {
        order = orders[orderId];
        if (order.buyer == address(0) || order.closed) revert UnavailableOrder();
    }

    function closeOrder(bytes32 orderId, Order storage order, uint256 supplierAward) private {
        uint256 buyerRefund = order.funded - order.released - supplierAward;
        order.closed = true;
        order.released += supplierAward;
        order.refunded = buyerRefund;
        if (supplierAward != 0) token.safeTransfer(order.supplier, supplierAward);
        if (buyerRefund != 0) token.safeTransfer(order.buyer, buyerRefund);
        emit Closed(orderId, supplierAward, buyerRefund);
    }
}
