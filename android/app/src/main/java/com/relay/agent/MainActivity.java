package com.relay.agent;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DshSocketPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
