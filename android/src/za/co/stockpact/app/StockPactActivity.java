package za.co.stockpact.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;

import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class StockPactActivity extends Activity {
    private static final int MEDIA_PERMISSION = 1;
    private static final int OPEN_FILE = 2;
    private static final int SAVE_FILE = 3;
    private static final int MAX_EXPORT_BYTES = 8 * 1024 * 1024;
    private Uri workspace;
    private WebView web;
    private FrameLayout root;
    private LinearLayout connectionError;
    private PermissionRequest mediaRequest;
    private ValueCallback<Uri[]> fileSelection;
    private byte[] pendingExport;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        try (InputStream input = getAssets().open("workspace-url.txt");
             BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            workspace = Uri.parse(reader.readLine().trim());
        } catch (IOException failure) {
            throw new IllegalStateException("The StockPact workspace is missing from this build.", failure);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(248, 244, 235));
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets padding = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
                return insets;
            });
        }
        setContentView(root);

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " StockPactAndroid/1");
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WorkspaceClient());
        web.setWebChromeClient(new WorkspaceChrome());
        web.setDownloadListener(this::download);
        if (state == null || web.restoreState(state) == null) web.loadUrl(workspace.toString());
    }

    private boolean workspaceOrigin(Uri uri) {
        return trustedHttps(uri) && workspace.getHost().equalsIgnoreCase(uri.getHost());
    }

    private boolean trustedHttps(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private final class WorkspaceClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!request.isForMainFrame() || workspaceOrigin(uri)) return false;
            if ("stockpact-export".equals(uri.getScheme()) && "save".equals(uri.getHost())
                && view.getUrl() != null && workspaceOrigin(Uri.parse(view.getUrl()))) {
                saveExport(uri.getQueryParameter("name"), uri.getQueryParameter("type"));
                return true;
            }
            if (trustedHttps(uri) && "login.trycloudflare.com".equalsIgnoreCase(uri.getHost())
                && workspace.getHost().endsWith(".trycloudflare.com")) return false;
            if (trustedHttps(uri)) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (android.content.ActivityNotFoundException ignored) { tell("No app can open this link."); }
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showConnectionError();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) showConnectionError();
        }
    }

    private final class WorkspaceChrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (!workspaceOrigin(request.getOrigin()) || mediaRequest != null) {
                request.deny();
                return;
            }
            List<String> missing = new ArrayList<>();
            for (String resource : request.getResources()) {
                String permission = androidPermission(resource);
                if (permission == null) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
            }
            if (missing.isEmpty()) request.grant(request.getResources());
            else {
                mediaRequest = request;
                requestPermissions(missing.toArray(new String[0]), MEDIA_PERMISSION);
            }
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (mediaRequest == request) mediaRequest = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> result, FileChooserParams params) {
            if (!workspaceOrigin(Uri.parse(view.getUrl()))) return false;
            if (fileSelection != null) fileSelection.onReceiveValue(null);
            fileSelection = result;
            try { startActivityForResult(params.createIntent(), OPEN_FILE); }
            catch (android.content.ActivityNotFoundException ignored) {
                fileSelection.onReceiveValue(null);
                fileSelection = null;
            }
            return true;
        }
    }

    private String androidPermission(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != MEDIA_PERMISSION || mediaRequest == null) return;
        PermissionRequest request = mediaRequest;
        mediaRequest = null;
        for (String resource : request.getResources()) {
            if (checkSelfPermission(androidPermission(resource)) != PackageManager.PERMISSION_GRANTED) {
                request.deny();
                return;
            }
        }
        request.grant(request.getResources());
    }

    private void download(String url, String agent, String disposition, String mime, long size) {
        if (!workspaceOrigin(Uri.parse(web.getUrl()))) return;
        Uri uri = Uri.parse(url);
        String name = URLUtil.guessFileName(url, disposition, mime);
        if (workspaceOrigin(uri)) {
            DownloadManager.Request request = new DownloadManager.Request(uri);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            request.addRequestHeader("User-Agent", agent);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
            try { getSystemService(DownloadManager.class).enqueue(request); }
            catch (IllegalArgumentException | IllegalStateException failure) { tell("Could not download this file."); }
            return;
        }
    }

    private void saveExport(String name, String mime) {
        if (pendingExport != null || name == null || !name.matches("[A-Za-z0-9._-]{1,100}")) return;
        if (!"text/plain".equals(mime) && !"text/csv".equals(mime)) return;
        web.evaluateJavascript("(() => { const read = window.stockPactAndroidExport; delete window.stockPactAndroidExport; return read ? read() : null; })()", result -> {
            try {
                Object data = new JSONArray("[" + result + "]").get(0);
                if (!(data instanceof String) || ((String) data).length() > MAX_EXPORT_BYTES * 2) throw new IllegalArgumentException();
                pendingExport = Base64.decode((String) data, Base64.DEFAULT);
                if (pendingExport.length > MAX_EXPORT_BYTES) throw new IllegalArgumentException();
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(save, SAVE_FILE);
            } catch (Exception failure) {
                pendingExport = null;
                tell("Could not save this export.");
            }
        });
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == OPEN_FILE && fileSelection != null) {
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result, data);
            if (selected != null) for (Uri uri : selected) {
                if (!"content".equals(uri.getScheme()) || getPackageName().equals(uri.getAuthority())) { selected = null; break; }
            }
            fileSelection.onReceiveValue(selected);
            fileSelection = null;
        }
        if (code == SAVE_FILE && pendingExport != null) {
            byte[] bytes = pendingExport;
            pendingExport = null;
            if (result != RESULT_OK || data == null || data.getData() == null) return;
            try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                if (output == null) throw new IOException();
                output.write(bytes);
            } catch (IOException | SecurityException failure) { tell("Could not save this export."); }
        }
    }

    private void showConnectionError() {
        if (connectionError != null) return;
        connectionError = new LinearLayout(this);
        connectionError.setOrientation(LinearLayout.VERTICAL);
        connectionError.setPadding(48, 80, 48, 48);
        connectionError.setBackgroundColor(Color.rgb(248, 244, 235));
        TextView message = new TextView(this);
        message.setText("StockPact cannot reach the workspace. Check your internet connection and try again.");
        message.setTextSize(20);
        connectionError.addView(message);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(view -> {
            root.removeView(connectionError);
            connectionError = null;
            web.setVisibility(View.VISIBLE);
            web.loadUrl(workspace.toString());
        });
        connectionError.addView(retry);
        web.setVisibility(View.INVISIBLE);
        root.addView(connectionError, new FrameLayout.LayoutParams(-1, -1));
    }

    private void tell(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }

    @Override
    protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }

    @Override
    protected void onPause() { CookieManager.getInstance().flush(); super.onPause(); }

    @Override
    public void onBackPressed() {
        if (connectionError == null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (mediaRequest != null) mediaRequest.deny();
        if (fileSelection != null) fileSelection.onReceiveValue(null);
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
