package com.keepit.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaDownloaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
