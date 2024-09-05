const CLIENT_ID = 'c08dd0211d9247a3b9f70cc54033f6ac';
const CLIENT_SECRET = '3847e81123c241fc8479c4d4ecf8f485';
const REDIRECT_URI = 'https://hfiaballdkncfjfbnahiclnfockjnbpc.chromiumapp.org/';
const SCOPE = 'user-read-private user-read-email playlist-read-private user-library-read user-modify-playback-state user-read-playback-state';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

function encodeFormData(data) {
  return Object.keys(data)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
    .join('&');
}

async function refreshAccessToken(refreshToken) {
  const params = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  };

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeFormData(params)
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in
    };
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw error;
  }
}

let isAudioPlaying = false;

function checkAudioStatus() {
  chrome.tabs.query({audible: true}, (tabs) => {
    const wasPlaying = isAudioPlaying;
    isAudioPlaying = tabs.length > 0;
    
    if (wasPlaying && !isAudioPlaying) {
      console.log('Audio stopped, notifying popup');
      chrome.runtime.sendMessage({action: 'audioStopped'});
    }
  });
}

chrome.alarms.create('checkAudio', { periodInMinutes: 1/60 }); // Check every second

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkAudio') {
    checkAudioStatus();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'login') {
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}`;

    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, async (redirectUrl) => {
      if (chrome.runtime.lastError) {
        console.error('Auth error:', chrome.runtime.lastError);
        sendResponse({success: false, error: chrome.runtime.lastError.message});
        return;
      }
      
      // ... token exchange code ...

      const code = new URL(redirectUrl).searchParams.get('code');
      
      if (!code) {
        console.error('No code in redirect URL');
        sendResponse({success: false, error: 'Authentication failed - no code received'});
        return;
      }

      try {
        const tokenResponse = await fetch(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET)
          },
          body: encodeFormData({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
          })
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to exchange code for token');
        }

        const tokenData = await tokenResponse.json();
        const expirationTime = Date.now() + tokenData.expires_in * 1000;

        chrome.storage.local.set({
          spotifyAccessToken: tokenData.access_token,
          spotifyRefreshToken: tokenData.refresh_token,
          spotifyTokenExpiration: expirationTime
        }, () => {
          console.log('Access token stored');
          sendResponse({success: true});
        });
      } catch (error) {
        console.error('Error during token exchange:', error);
        sendResponse({success: false, error: error.message});
      }
    });
    
    return true; // Indicates we will respond asynchronously
  } else if (request.action === 'logout') {
    chrome.storage.local.remove(['spotifyAccessToken', 'spotifyRefreshToken', 'spotifyTokenExpiration'], () => {
      sendResponse({success: true});
    });
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSpotifyToken') {
    chrome.storage.local.get(['spotifyAccessToken', 'spotifyRefreshToken', 'spotifyTokenExpiration'], async (result) => {
      if (!result.spotifyAccessToken || !result.spotifyRefreshToken) {
        sendResponse({success: false, error: 'No token available'});
        return;
      }

      if (Date.now() > result.spotifyTokenExpiration) {
        try {
          const { accessToken, expiresIn } = await refreshAccessToken(result.spotifyRefreshToken);
          const newExpirationTime = Date.now() + expiresIn * 1000;

          chrome.storage.local.set({
            spotifyAccessToken: accessToken,
            spotifyTokenExpiration: newExpirationTime
          }, () => {
            sendResponse({success: true, token: accessToken});
          });
        } catch (error) {
          sendResponse({success: false, error: 'Failed to refresh token'});
        }
      } else {
        sendResponse({success: true, token: result.spotifyAccessToken});
      }
    });
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAudioStatus') {
    sendResponse({isPlaying: isAudioPlaying});
  }
  // ... existing message handlers ...
});
