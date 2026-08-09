# Parallax

**Parallax** is a streamlined citation and project manager built for research. 

## ✨ Features
- **Live Rendering:** Full support for live-rendering LaTeX and TikZ.
- **Project Management:** Built-in tools tailored specifically for research workflows.
- **Hierarchical Organization:** A tag-based system to neatly categorize papers, discussions, books, and talks.
- **Seamless Asset Linking:** Easily attach external resources like videos, websites, and PDFs.
- **Smart PDFs:** Automatic linking and detection of PDF files.

## 🚀 Getting Started

### 1. Prerequisites
Parallax requires Rust's package manager to run. If you don't have it yet, you will need to [install Cargo](https://doc.rust-lang.org/cargo/getting-started/installation.html).

### 2. Download and Run the Server
1. Download the `server.tar.xz` file from the **Nightly Releases** page and extract it.
2. Open your terminal in the extracted folder and start the server by pointing it to your base directory:
   ```sh
   cargo run --release -- [path to base]
   ```

> **First time using Parallax? Try the demo!**
> The demo base also serves as the documentation. To use it, download `demo.tar.xz` from the nightly releases, extract it, and run the server with the demo path:
> ```sh
> cargo run --release -- demo
> ```

### 3. Connect the Client
1. Head over to the [Hosted Parallax Client](https://yanik-kleibrink.github.io/parallax).
2. Click the **+** (plus) icon to add your base. 
3. If you are using the default local or demo configuration, fill out the connection form with the following details:
   * **Name:** `local` *(or a name of your choice)*
   * **Domain:** `localhost`
   * **Port:** `20777`
   * **TLS:** `no`
   * **Token:** *(Leave this blank)*

### 4. Start Exploring
You can now open the base! 

If you are running the demo, start by clicking the **central binocular icon** (hovering over it will display *"Getting Started"*). 

*💡 **Tip:** You can install the web client as a PWA (Progressive Web App) on your device for quick, app-like access anytime.*

---

## 🤝 Contributing & Development

Contributions are very welcome! Whether it's fixing bugs, adding new features, or improving documentation, we'd love to have your help. 

### Setting Up a Development Environment
To get your local development environment ready, you will need to prepare the required assets and generate the UI icons before building. From the project root, run:

```sh
./prepare_assets.sh
cd client
npm run generate-icons
``` 
