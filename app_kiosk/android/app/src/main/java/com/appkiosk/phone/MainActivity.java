package com.appkiosk.phone;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(KioskServerPlugin.class);
		super.onCreate(savedInstanceState);

		java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
				&& checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
			permissions.add(Manifest.permission.POST_NOTIFICATIONS);
		}
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
				&& checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
			permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
		}
		if (!permissions.isEmpty()) {
			requestPermissions(permissions.toArray(new String[0]), 42);
		}
	}
}
