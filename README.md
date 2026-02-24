# Harmantic

Browser extension that records API traffic and generates test cases (pytest / Jest / Playwright).

Supports Chrome, Firefox, and Safari via [WXT](https://wxt.dev).

## Usage

1. Open DevTools → **Harmantic** tab
2. Click **Start Recording** and use your app
3. Click **Mark Flow** to separate test cases (optional)
4. Click **Generate Tests** to download a test file

## Development

```bash
npm install

# Chrome (hot reload)
npm run dev

# Firefox
npm run dev:firefox

# Build for all browsers
npm run build && npm run build:firefox && npm run build:safari
```

## Output formats

The extension generates **pytest** by default. Jest/Playwright coming soon via settings panel.
