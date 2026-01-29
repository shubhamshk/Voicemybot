# Janitor Voice

**A Chrome Extension that adds automatic Text-to-Speech (TTS) voice to character messages on Janitor AI.**

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

---

## 🎯 Features

- ✅ **Automatic TTS** - Character replies are spoken automatically in real-time
- ✅ **Customizable Voice Settings** - Adjust speech rate, pitch, and select from available voices
- ✅ **Draggable Control Panel** - Modern, non-intrusive UI overlay
- ✅ **Smart Message Detection** - Uses MutationObserver to detect only new character messages
- ✅ **Persistent Settings** - All preferences are saved and restored on page reload
- ✅ **Keyboard Shortcut** - Toggle voice with `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac)
- ✅ **Tab Visibility Management** - Automatically pauses when tab is hidden
- ✅ **Queue Management** - Handles multiple messages without overlap
- ✅ **Extensible Architecture** - Designed to support future TTS providers (ElevenLabs, PlayHT, Azure)

---

## 📦 Installation

### Method 1: Load Unpacked Extension (Developer Mode)

1. **Download/Clone** this repository to your local machine

2. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/`
   - Or click Menu → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load Extension**
   - Click "Load unpacked"
   - Select the `janitor-voice` folder

5. **Verify Installation**
   - You should see "Janitor Voice" in your extensions list
   - The extension icon (🎤) will appear in your toolbar

---

## 🚀 Usage

### Quick Start

1. **Visit Janitor AI**
   - Go to https://janitorai.com
   - Start or continue a conversation

2. **Enable Voice**
   - Click the floating control panel (appears automatically)
   - Toggle "🎤 Enable Voice" button
   - OR press `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac)

3. **Customize Settings** (Optional)
   - **Speech Rate**: Adjust from 0.5x to 2x (slower to faster)
   - **Pitch**: Adjust from 0.5 to 2 (lower to higher)
   - **Voice**: Select from available system voices

4. **Enjoy**
   - New character messages will be automatically spoken!

### Control Panel Features

The floating control panel includes:

- **Toggle Switch** - Enable/disable voice mode
- **Speech Rate Slider** - Control how fast the voice speaks
- **Pitch Slider** - Adjust voice pitch
- **Voice Selector** - Choose from available voices
- **Status Indicator** - Shows current state (Active, Inactive, Speaking)
- **Minimize Button** - Collapse panel to just the header
- **Close Button** - Hide panel (reload page to show again)
- **Draggable Header** - Move panel anywhere on the screen

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+V` (Windows/Linux) | Toggle voice on/off |
| `Cmd+Shift+V` (Mac) | Toggle voice on/off |

---

## 🏗️ Project Structure

```
janitor-voice/
├── manifest.json       # Extension configuration
├── content.js          # Main content script
├── styles.css          # UI styles
├── popup.html          # Extension popup interface
├── popup.js            # Popup logic
└── README.md           # This file
```

### File Descriptions

- **manifest.json**: Manifest V3 configuration with permissions and content script declarations
- **content.js**: Complete TTS engine, message detector, UI panel, and voice controller
- **styles.css**: Modern, gradient-based UI with smooth animations
- **popup.html**: Extension popup with usage instructions
- **popup.js**: Popup script to check active tab status

---

## 🎨 UI Overview

The extension features a beautiful, modern control panel with:

- **Dark gradient background** with glassmorphism effects
- **Smooth animations** and transitions
- **Draggable interface** - position it anywhere
- **Responsive design** - works on all screen sizes
- **Accessible controls** - keyboard navigation support

---

## 🔧 Technical Details

### Architecture

The extension uses a modular, object-oriented architecture:

#### Core Components

1. **TTSEngine** (Abstract Class)
   - Defines interface for TTS providers
   - Allows easy swapping of speech engines

2. **WebSpeechTTS** (Concrete Implementation)
   - Implements Web Speech API
   - Manages speech queue and utterances
   - Handles pause/resume/stop operations

3. **MessageDetector**
   - Uses MutationObserver to watch DOM
   - Detects new character messages
   - Filters out user messages and duplicates
   - Uses WeakSet to track processed messages

4. **VoiceController** (Orchestrator)
   - Coordinates all components
   - Manages settings and state
   - Handles keyboard shortcuts
   - Manages visibility changes

5. **UIPanel**
   - Creates draggable control interface
   - Handles user interactions
   - Updates visual feedback
   - Persists settings

### Technologies Used

- **Manifest V3** - Latest Chrome Extension standard
- **Web Speech API** - Native browser TTS
- **MutationObserver API** - DOM change detection
- **LocalStorage API** - Settings persistence
- **Vanilla JavaScript (ES6+)** - No external dependencies
- **CSS3** - Modern styling with animations

### Settings Persistence

All settings are stored in `localStorage` with the prefix `janitor_voice_`:

- `enabled` - Voice on/off state
- `rate` - Speech rate (0.5 - 2.0)
- `pitch` - Voice pitch (0.5 - 2.0)
- `voiceURI` - Selected voice identifier
- `volume` - Speech volume (0.0 - 1.0)

---

## 🔮 Future Extensibility

### TTS Provider Abstraction

The architecture is designed to support multiple TTS providers:

```javascript
// Current: Web Speech API
const ttsEngine = new WebSpeechTTS();

// Future: ElevenLabs
const ttsEngine = new ElevenLabsTTS(apiKey);

// Future: PlayHT
const ttsEngine = new PlayHTTTS(apiKey);

// Future: Azure TTS
const ttsEngine = new AzureTTS(apiKey);
```

### Adding a New TTS Provider

To add a new provider:

1. Create a new class extending `TTSEngine`
2. Implement all required methods:
   - `initialize()`
   - `speak(text, options)`
   - `stop()`
   - `pause()`
   - `resume()`
   - `isSpeaking()`
   - `getVoices()`
3. Update `VoiceController` to use new engine
4. Add UI for API key configuration (if needed)

**Important**: Never commit API keys to the repository!

---

## 🐛 Troubleshooting

### Voice Not Working

1. **Check if voice is enabled**
   - Look for green "✓ Voice Active" status
   - Try toggling with `Ctrl+Shift+V`

2. **Verify you're on Janitor AI**
   - Extension only works on https://janitorai.com/*
   - Check extension popup for status

3. **Check browser permissions**
   - Ensure extension has access to Janitor AI
   - Go to chrome://extensions/ and check permissions

4. **Test system voices**
   - Try different voices from the dropdown
   - Some voices may not be available on your system

### Panel Not Appearing

1. **Reload the page**
   - The panel should appear automatically
   - Try hard refresh: `Ctrl+Shift+R`

2. **Check console for errors**
   - Open DevTools (`F12`)
   - Look for errors in Console tab
   - Messages prefixed with `[Janitor Voice]`

3. **Verify extension is active**
   - Go to chrome://extensions/
   - Ensure "Janitor Voice" is enabled

### Messages Not Being Detected

1. **Site structure may have changed**
   - Janitor AI may have updated their HTML
   - Check `CONFIG.SELECTORS` in `content.js`
   - May need to update selectors

2. **Check console logs**
   - Look for `[Janitor Voice] New character message:` logs
   - If not appearing, detector may need adjustment

---

## 🛠️ Development

### Prerequisites

- Google Chrome (latest version)
- Basic knowledge of JavaScript, HTML, CSS
- Familiarity with Chrome Extension development

### Making Changes

1. **Edit source files**
   - Modify `content.js`, `styles.css`, etc.

2. **Reload extension**
   - Go to chrome://extensions/
   - Click the refresh icon on "Janitor Voice"

3. **Test changes**
   - Reload Janitor AI page
   - Test functionality

### Debugging

- **Content Script**: Use DevTools Console (F12) on Janitor AI page
- **Popup**: Right-click extension icon → Inspect popup
- **Background**: Check chrome://extensions/ → Background page (if added)

### Best Practices

- ✅ Use ES6+ features
- ✅ Add comments for complex logic
- ✅ Follow existing code style
- ✅ Test on different voices and rates
- ✅ Ensure no memory leaks (WeakSet usage)
- ✅ Handle errors gracefully

---

## 📝 License

This project is provided as-is for personal use. Feel free to modify and extend it for your own needs.

---

## 🤝 Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## 📮 Support

If you encounter issues or have questions:

1. Check the Troubleshooting section above
2. Review console logs for error messages
3. Open an issue with detailed information:
   - Chrome version
   - Extension version
   - Steps to reproduce
   - Console errors (if any)

---

## 🎉 Acknowledgments

- Built for the Janitor AI community
- Uses Chrome Web Speech API
- Inspired by modern extension design patterns

---

## 📌 Version History

### v1.0.0 (Initial Release)
- ✅ Core TTS functionality with Web Speech API
- ✅ Draggable control panel
- ✅ Message detection with MutationObserver
- ✅ Settings persistence
- ✅ Keyboard shortcuts
- ✅ Tab visibility management
- ✅ Queue management
- ✅ Extensible architecture for future TTS providers

---

**Enjoy your enhanced Janitor AI experience with voice! 🎤✨**
