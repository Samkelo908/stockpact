// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Valueless token for the StockPact testnet walkthrough.
contract TestStock is ERC20 {
    constructor(address recipient, uint256 supply) ERC20("StockPact Test Stock", "TSTK") {
        _mint(recipient, supply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
