# Install and Run Guide  
  
This guide explains how to run Markdown Vault App on macOS.  
  
## 1. Requirements  
  
You should have:  
  
- macOS  
- Node.js installed  
- npm available  
- the project repo available locally  
  
---  
  
## 2. Run in development mode  
  
Open Terminal and go to the desktop app folder:  

```
cd ~/code/markdown-vault-app/apps/desktop
```

Install dependencies:

```
npm install
```

Start the app:

```
npm run dev
```

If this succeeds, the Electron app window should open.

---

## 3. Build a local packaged app

From the desktop app folder:

```
cd ~/code/markdown-vault-app/apps/desktop
npm run pack
```

This creates an unpacked `.app` in `dist/` for local testing. That is enough for Day 28.

This should create packaged build artifacts inside:

```
apps/desktop/dist/
```

---

## 4. Open the packaged app

If the app crashes silently on first open, run this once in Terminal:

```
codesign --force --deep --sign - apps/desktop/dist/mac-arm64/markdown-vault-desktop.app
```

Then try opening it again. This is a known issue with local unsigned Electron builds.

---

## 5. First launch workflow

When the app opens:

1. Click **Choose Vault**
2. Select a folder on disk
3. Optionally click **Create Demo Vault**
4. Open notes from the list
5. Try search
6. Try the **AI Imports** filter

---

## 6. Recommended first vault choices

For testing, choose one of these:

- an empty test folder
- a demo folder created just for this app
- a copy of a safe Markdown folder

Do not use an important real notes folder until you trust the app.

---

## 7. Create a demo vault quickly

After choosing a vault, click:

```
Create Demo Vault
```

This creates sample notes so you can test the app quickly.

---

## 8. Common problems

### Problem: `npm run dev` fails

Try:

```
npm install
```

again inside `apps/desktop`.

### Problem: packaged app builds but does not open

Check:

- required files are included in packaging
- the build completed successfully
- Gatekeeper is not blocking the unsigned build

### Problem: app opens but no notes appear

Check:

- did you choose a vault?
- did you click **Create Demo Vault** or load real notes?
- are there `.md` files inside the selected vault?

---

## 9. What “working” looks like

A successful install/run means:

- app launches
- vault can be selected
- notes can be edited and saved
- search works
- demo vault works
- AI Imports filter can show imported notes

  
---  
   
