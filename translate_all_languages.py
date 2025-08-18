#!/usr/bin/env python3
"""
Translation Script for MicronsHub
Translates the complete German translation file to all other languages
"""

import json
import os
from googletrans import Translator
import time

# Language codes mapping
LANGUAGES = {
    'fr': 'French',
    'es': 'Spanish', 
    'it': 'Italian',
    'nl': 'Dutch',
    'pl': 'Polish',
    'pt': 'Portuguese',
    'sv': 'Swedish',
    'da': 'Danish',
    'fi': 'Finnish',
    'nb': 'Norwegian',
    'hu': 'Hungarian',
    'cs': 'Czech'
}

def load_german_translations():
    """Load the complete German translation file"""
    try:
        with open('src/locales/de/translation.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print("❌ German translation file not found!")
        return None
    except json.JSONDecodeError:
        print("❌ Invalid JSON in German translation file!")
        return None

def translate_text(text, target_lang, translator):
    """Translate a single text to target language"""
    try:
        # Add delay to avoid rate limiting
        time.sleep(0.1)
        result = translator.translate(text, dest=target_lang)
        return result.text
    except Exception as e:
        print(f"⚠️  Translation error for '{text[:50]}...': {e}")
        return text  # Return original text if translation fails

def translate_file(german_data, target_lang, translator):
    """Translate the entire German file to target language"""
    print(f"🔄 Translating to {LANGUAGES[target_lang]} ({target_lang})...")
    
    translated_data = {}
    total_keys = len(german_data.keys())
    
    for i, (key, value) in enumerate(german_data.items(), 1):
        if isinstance(value, str):
            # Translate string values
            translated_value = translate_text(value, target_lang, translator)
            translated_data[key] = translated_value
        elif isinstance(value, list):
            # Translate list values
            translated_list = []
            for item in value:
                if isinstance(item, str):
                    translated_item = translate_text(item, target_lang, translator)
                    translated_list.append(translated_item)
                else:
                    translated_list.append(item)
            translated_data[key] = translated_list
        else:
            # Keep non-string values as-is (numbers, booleans, etc.)
            translated_data[key] = value
        
        # Progress indicator
        if i % 50 == 0:
            print(f"   Progress: {i}/{total_keys} keys translated")
    
    return translated_data

def save_translation(translated_data, target_lang):
    """Save translated data to file"""
    output_file = f'src/locales/{target_lang}/translation.json'
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    
    # Save with proper formatting
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(translated_data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ Saved {target_lang} translation ({len(translated_data)} keys)")

def main():
    """Main translation process"""
    print("🚀 Starting translation of German file to all languages...")
    
    # Load German translations
    german_data = load_german_translations()
    if not german_data:
        return
    
    print(f"📖 Loaded German file with {len(german_data)} translation keys")
    
    # Initialize translator
    translator = Translator()
    
    # Translate to each language
    for lang_code in LANGUAGES.keys():
        try:
            # Skip German (source language)
            if lang_code == 'de':
                continue
                
            # Translate the file
            translated_data = translate_file(german_data, lang_code, translator)
            
            # Save the translation
            save_translation(translated_data, lang_code)
            
            print(f"✅ Completed {LANGUAGES[lang_code]} translation")
            print("-" * 50)
            
        except Exception as e:
            print(f"❌ Error translating to {lang_code}: {e}")
            continue
    
    print("🎉 Translation process completed!")
    print("\n📊 Summary:")
    print(f"- Source: German ({len(german_data)} keys)")
    print(f"- Translated to: {len(LANGUAGES)} languages")
    print("- Languages: " + ", ".join(LANGUAGES.keys()))

if __name__ == "__main__":
    main() 