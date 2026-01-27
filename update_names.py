import csv
import random

# Seznam náhodných anglických jmen (křestní jméno a příjmení)
RANDOM_NAMES = [
    ("Alexander", "Johnson"), ("Benjamin", "Smith"), ("Charles", "Brown"), ("David", "Wilson"),
    ("Edward", "Davis"), ("Frank", "Miller"), ("George", "Taylor"), ("Henry", "Anderson"),
    ("Isaac", "Thomas"), ("James", "Jackson"), ("Kevin", "White"), ("Leonard", "Harris"),
    ("Michael", "Martin"), ("Nathan", "Thompson"), ("Oliver", "Garcia"), ("Patrick", "Martinez"),
    ("Quincy", "Robinson"), ("Richard", "Clark"), ("Samuel", "Rodriguez"), ("Thomas", "Lewis"),
    ("Ulysses", "Lee"), ("Victor", "Walker"), ("William", "Hall"), ("Xavier", "Young"),
    ("Yuri", "Hernandez"), ("Zachary", "King"), ("Adam", "Wright"), ("Arthur", "Lopez"),
    ("Augustine", "Hill"), ("Austin", "Scott"), ("Ashton", "Green"), ("Adrian", "Adams"),
    ("Amy", "Collins"), ("Anna", "Miller"), ("Amanda", "Davis"), ("Angela", "Wilson"),
    ("Alice", "Moore"), ("Abigail", "Taylor"), ("Aurora", "Anderson"), ("Aubrey", "Thomas")
]

# Přečti CSV soubor
input_file = r"c:\Users\klesk\OneDrive\MtG\Decklist check\test_data\test_data.csv"
output_file = r"c:\Users\klesk\OneDrive\MtG\Decklist check\test_data\test_data.csv"

rows = []
with open(input_file, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Vyber náhodné jméno
        first_name, last_name = random.choice(RANDOM_NAMES)
        row['first_name'] = first_name
        row['last_name'] = last_name
        row['best_identifier'] = f"{first_name} {last_name}"
        row['email'] = "dummy@email.com"
        row['wizards_email'] = "dummy@email.com"
        rows.append(row)

# Zapiš do souboru
with open(output_file, 'w', encoding='utf-8', newline='') as f:
    if rows:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

print(f"✓ Soubor aktualizován. {len(rows)} řádků zpracováno.")