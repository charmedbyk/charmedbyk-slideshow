from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
import time
import json

# Load categories
with open("data/category_links.json", "r") as f:
    categories = json.load(f)

def new_driver():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    return webdriver.Chrome(options=options)  # Selenium Manager handles the driver

driver = new_driver()

all_products = []

def detect_category(name):
    name = name.lower()
    if "necklace" in name:
        return "Necklace"
    elif "earring" in name:
        return "Earrings"
    elif "bracelet" in name:
        return "Bracelet"
    elif "ring" in name:
        return "Ring"
    elif "hair" in name or "clip" in name:
        return "Hair Accessories"
    else:
        return "Other"

for category, url in categories.items():
    print(f"Scraping category: {category}")
    driver.get(url)
    time.sleep(5)

    while True:
        items = driver.find_elements(By.CSS_SELECTOR, '[data-testid="inventory-item"]')
        print(f"  Found {len(items)} items on this page")

        for item in items:
            try:
                name = item.find_element(By.CLASS_NAME, "InventoryItem_productGroupName__bbByr").text.strip()
                image = item.find_element(By.TAG_NAME, "img").get_attribute("src")
                cat = detect_category(name)
                all_products.append({
                    "name": name,
                    "image": image,
                    "category": category or cat
                })
            except Exception as e:
                print("  Skipping item due to error:", e)

        # Check for "Next" button and click it if available
        try:
            next_button = driver.find_element(By.XPATH, '//button[span[text()="Next"] and not(@disabled)]')
            driver.execute_script("arguments[0].click();", next_button)
            time.sleep(3)
        except:
            print("  No more pages.")
            break

driver.quit()

# Save to JSON
with open("docs/products.json", "w", encoding="utf-8") as f:
    json.dump(all_products, f, indent=2)

print(f"✅ Done. Saved {len(all_products)} products.")
