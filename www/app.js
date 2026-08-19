import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { PushNotifications } from '@capacitor/push-notifications';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const PORTAL_URL = 'https://neorcmportal.com';
const API_BASE = 'https://neorcmportal.com/api/v1';
let isOnline = true;

// --- Network Monitoring ---
async function initNetwork() {
  const status = await Network.getStatus();
  isOnline = status.connected;
  updateOfflineBanner();
  Network.addListener('networkStatusChange', (s) => {
    isOnline = s.connected;
    updateOfflineBanner();
    if (s.connected) loadPortal();
  });
}

function updateOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.classList.toggle('show', !isOnline);
}

// --- Biometric Auth ---
async function authenticate() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { BiometricAuth } = await import('@capacitor-community/biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Unlock Neo RCM Portal' });
    }
    await Haptics.impact({ style: ImpactStyle.Light });
    loadPortal();
  } catch (e) {
    console.log('Biometric failed, falling back:', e);
    skipAuth();
  }
}
window.authenticate = authenticate;

async function skipAuth() {
  loadPortal();
}
window.skipAuth = skipAuth;

// --- Load Portal WebView ---
function loadPortal() {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'block';
  
  if (!isOnline) {
    showOfflinePage();
    return;
  }
  // Redirect to portal
  window.location.href = PORTAL_URL;
}

function showOfflinePage() {
  document.getElementById('authScreen').innerHTML = `
    <div class="logo">Neo RCM</div>
    <div class="subtitle">You are currently offline</div>
    <p style="text-align:center;max-width:280px;opacity:0.7;font-size:14px;line-height:1.5;margin-bottom:30px;">Please check your internet connection. The app will automatically reconnect when available.</p>
    <button class="auth-btn" onclick="location.reload()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
      Retry Connection
    </button>
  `;
}

// --- Push Notifications ---
async function initPushNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  
  await PushNotifications.register();
  
  PushNotifications.addListener('registration', async (token) => {
    console.log('Push token:', token.value);
    // Save token locally
    await Preferences.set({ key: 'pushToken', value: token.value });
    // Send to backend
    try {
      const authToken = await Preferences.get({ key: 'authToken' });
      if (authToken.value) {
        fetch(`${API_BASE}/notifications/register-device`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken.value}` },
          body: JSON.stringify({ token: token.value, platform: Capacitor.getPlatform() })
        });
      }
    } catch (e) { console.log('Token registration failed:', e); }
  });
  
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('Push received:', notification);
  });
  
  PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
    console.log('Push action:', notification);
    const data = notification.notification.data;
    if (data && data.url) window.location.href = data.url;
  });
}

// --- App Lifecycle ---
async function initApp() {
  try {
    if (Capacitor.isNativePlatform()) {
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setBackgroundColor({ color: '#0f766e' });
    }
  } catch (e) {}
  
  await initNetwork();
  await initPushNotifications();
  
  // Handle back button on Android
  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else CapApp.exitApp();
  });
  
  // Handle app URL open (deep links)
  CapApp.addListener('appUrlOpen', (event) => {
    const slug = event.url.split('neorcmportal.com').pop();
    if (slug) window.location.href = PORTAL_URL + slug;
  });
  
  // Check if user has saved auth
  const saved = await Preferences.get({ key: 'authToken' });
  if (saved.value) {
    loadPortal();
  }
  
  // Hide splash screen
  try { await SplashScreen.hide(); } catch (e) {}
}

// Init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
