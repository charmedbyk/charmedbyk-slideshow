# charmedbyk-slideshow

[![Update products.json](https://github.com/charmedbyk/charmedbyk-slideshow/actions/workflows/update-products.yml/badge.svg)](https://github.com/charmedbyk/charmedbyk-slideshow/actions/workflows/update-products.yml)

> Automated product feed + slideshow site for [CharmedByK](https://www.charmedbyk.com)

---

## 📖 Overview

This repo powers a **daily-updated slideshow website** for CharmedByK jewelry sales.  
It combines:

- **A Python Selenium scraper** (`src/product_updater.py`)  
  that pulls product info from the Paparazzi Premiere storefront using URLs listed in `data/category_links.json`.  
- **A GitHub Actions workflow** (`.github/workflows/update-products.yml`)  
  that runs every day at 02:00 UTC, regenerates `docs/products.json`, and commits the update automatically.  
- **A GitHub Pages site** (`docs/`)  
  that serves a live slideshow (`docs/index.html`) backed by the latest `products.json`.

---

## 📂 Repository structure

```
.
├─ .github/workflows/         # CI/CD automation
│  └─ update-products.yml     # Daily scraper job
├─ docs/                      # Public site (GitHub Pages)
│  ├─ index.html              # Slideshow page
│  ├─ products.json           # Auto-updated daily
│  └─ CNAME                   # Custom domain config
├─ src/
│  └─ product_updater.py      # Python scraper
├─ data/
│  └─ category_links.json     # Category → URL mapping
├─ requirements.txt           # Python dependencies
├─ README.md                  # Project documentation
└─ .gitignore                 # Build/debug ignores
```


## ⚙️ How it works

1. **Daily schedule**  
   GitHub Actions runs the scraper every day at 02:00 UTC (and can also be triggered manually).

2. **Scraping**  
   The scraper visits each category URL from `data/category_links.json`, extracts product names, images, and categories, and saves them to `docs/products.json`.

3. **Deployment**  
   GitHub Pages hosts the contents of `docs/`.  
   - `index.html` loads `products.json` and renders a rotating slideshow of the current inventory.  
   - The `CNAME` ensures the site is available at [slideshow.charmedbyk.com](https://slideshow.charmedbyk.com).

4. **Automation**  
   - If `products.json` changes, the workflow commits it back to `main`.  
   - A [status badge](#charmedbyk-slideshow) shows whether the last run succeeded.

---

## 🚀 Usage

### Run scraper locally

```bash
# Clone the repo
git clone https://github.com/gotthiskil8/charmedbyk-slideshow.git
cd charmedbyk-slideshow

# Install dependencies
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run scraper
python src/product_updater.py

This will update docs/products.json locally.

View slideshow

Open docs/index.html in a browser, or visit the deployed site:

👉 https://slideshow.charmedbyk.com

⸻

🔧 Development notes
	•	requirements.txt is at repo root so CI and local dev stay consistent.
	•	debug/ folder is git-ignored but may be created by the scraper for troubleshooting.
	•	Branch protection is supported — the workflow can be adjusted to open a PR instead of pushing directly.

⸻

📅 Roadmap / Ideas
	•	Add filtering controls (by category, price, etc.)
	•	Display inventory counts if available
	•	Enhance styling for mobile
	•	Extend scraper to handle new collections automatically

⸻

📜 License

This project is private to CharmedByK. Please do not redistribute without permission.

⸻

