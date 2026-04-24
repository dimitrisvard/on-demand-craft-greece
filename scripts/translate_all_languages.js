#!/usr/bin/env node
/**
 * Translation Script for MicronsHub
 * Translates the complete German translation file to all other languages
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Language codes mapping
const LANGUAGES = {
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
};

// Simple translation function using Google Translate API
async function translateText(text, targetLang) {
    try {
        // Using Google Translate API endpoint
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await response.json();
        return data[0][0][0];
    } catch (error) {
        console.log(`⚠️  Translation error for '${text.substring(0, 50)}...': ${error.message}`);
        return text; // Return original text if translation fails
    }
}

function loadGermanTranslations() {
    try {
        const filePath = path.join(__dirname, '..', 'src', 'locales', 'de', 'translation.json');
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log('❌ German translation file not found or invalid!');
        return null;
    }
}

async function translateFile(germanData, targetLang) {
    console.log(`🔄 Translating to ${LANGUAGES[targetLang]} (${targetLang})...`);
    
    const translatedData = {};
    const totalKeys = Object.keys(germanData).length;
    
    for (let i = 0; i < totalKeys; i++) {
        const key = Object.keys(germanData)[i];
        const value = germanData[key];
        
        if (typeof value === 'string') {
            // Translate string values
            const translatedValue = await translateText(value, targetLang);
            translatedData[key] = translatedValue;
        } else if (Array.isArray(value)) {
            // Translate list values
            const translatedList = [];
            for (const item of value) {
                if (typeof item === 'string') {
                    const translatedItem = await translateText(item, targetLang);
                    translatedList.push(translatedItem);
                } else {
                    translatedList.push(item);
                }
            }
            translatedData[key] = translatedList;
        } else {
            // Keep non-string values as-is (numbers, booleans, etc.)
            translatedData[key] = value;
        }
        
        // Progress indicator
        if ((i + 1) % 50 === 0) {
            console.log(`   Progress: ${i + 1}/${totalKeys} keys translated`);
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return translatedData;
}

function saveTranslation(translatedData, targetLang) {
    const outputDir = path.join(__dirname, '..', 'src', 'locales', targetLang);
    const outputFile = path.join(outputDir, 'translation.json');
    
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Save with proper formatting
    fs.writeFileSync(outputFile, JSON.stringify(translatedData, null, 2), 'utf8');
    
    console.log(`✅ Saved ${targetLang} translation (${Object.keys(translatedData).length} keys)`);
}

async function main() {
    console.log('🚀 Starting translation of German file to all languages...');
    
    // Load German translations
    const germanData = loadGermanTranslations();
    if (!germanData) {
        return;
    }
    
    console.log(`📖 Loaded German file with ${Object.keys(germanData).length} translation keys`);
    
    // Translate to each language
    for (const langCode of Object.keys(LANGUAGES)) {
        try {
            // Skip German (source language)
            if (langCode === 'de') {
                continue;
            }
            
            // Translate the file
            const translatedData = await translateFile(germanData, langCode);
            
            // Save the translation
            saveTranslation(translatedData, langCode);
            
            console.log(`✅ Completed ${LANGUAGES[langCode]} translation`);
            console.log('-'.repeat(50));
            
        } catch (error) {
            console.log(`❌ Error translating to ${langCode}: ${error.message}`);
            continue;
        }
    }
    
    console.log('🎉 Translation process completed!');
    console.log('\n📊 Summary:');
    console.log(`- Source: German (${Object.keys(germanData).length} keys)`);
    console.log(`- Translated to: ${Object.keys(LANGUAGES).length} languages`);
    console.log(`- Languages: ${Object.keys(LANGUAGES).join(', ')}`);
}

// Run the script
main().catch(console.error); 