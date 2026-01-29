# 🎤 Janitor Voice - Quick Reference

## Installation (3 Steps)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → Select `janitor-voice` folder

## Usage

1. Visit **janitorai.com**
2. Click **Enable Voice** in floating panel
3. Character replies are now spoken automatically!

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Toggle Voice | `Ctrl+Shift+V` (Windows/Linux)<br>`Cmd+Shift+V` (Mac) |

## Control Panel

- **Toggle**: Enable/disable voice
- **Speech Rate**: 0.5x - 2x (speed)
- **Pitch**: 0.5 - 2 (tone)
- **Voice**: Select from available voices
- **Drag**: Click header to move panel
- **Minimize**: Click "−" button
- **Close**: Click "×" button

## Settings Persist Automatically

All your preferences are saved:
- ✓ Enabled/disabled state
- ✓ Speech rate
- ✓ Pitch
- ✓ Selected voice

## Troubleshooting

### No voice?
- Check system volume
- Try a different voice
- Verify you're on janitorai.com

### Panel not showing?
- Reload page (F5)
- Check chrome://extensions/
- Hard reload (Ctrl+Shift+R)

### Messages not detected?
- Open Console (F12)
- Look for `[Janitor Voice]` logs
- Site structure may have changed

## Console Debug

```javascript
// Check extension state
window.janitorVoiceController

// Check settings
localStorage.getItem('janitor_voice_enabled')
```

## Architecture (For Developers)

```
TTSEngine (abstract)
  └── WebSpeechTTS (implementation)

MessageDetector
  └── MutationObserver-based

VoiceController (orchestrator)
  ├── TTSEngine
  ├── MessageDetector
  └── UIPanel
```

## Future TTS Providers

The architecture supports swapping engines:

```javascript
// Current
const tts = new WebSpeechTTS();

// Future options
const tts = new ElevenLabsTTS(apiKey);
const tts = new PlayHTTTS(apiKey);
const tts = new AzureTTS(apiKey);
```

## Files

```
janitor-voice/
├── manifest.json      # Extension config
├── content.js         # Main logic (26KB)
├── styles.css         # UI styles
├── popup.html         # Extension popup
├── popup.js           # Popup logic
├── icon*.png          # Extension icons
├── README.md          # Full documentation
└── INSTALLATION.md    # Setup guide
```

## Support

- Check `README.md` for detailed info
- Check `INSTALLATION.md` for setup help
- Open Console (F12) for debug logs
- Check chrome://extensions/ for extension status

---

**Made with ❤️ for Janitor AI users**
