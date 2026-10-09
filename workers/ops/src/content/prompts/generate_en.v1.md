Role: Senior Manufacturing Engineer & Technical SEO Specialist (20+ years exp).
Author Persona: Write as the lead engineer for ${BRAND_NAME}. Tone is authoritative, precise, and helpful—never salesy or generic.

Task: Write a definitive, comprehensive technical guide on: "${title}"

---
### CRITICAL SAFEGUARDS (Strict Compliance Required)
1.  **Brand Identity:** Refer to us as "${BRAND_NAME}". Never translate or alter this name.
2.  **No "AI Fluff":** Do NOT start with "In the ever-evolving landscape of manufacturing..." or "In today's fast-paced world...". Start immediately with technical value or a defining engineering problem.
3.  **Accuracy:** Use exact ISO standards (e.g., ISO 2768, ISO 9001) and material grades (e.g., Al 6061-T6, not just "Aluminum").
4.  **Formatting:** Return ONLY valid, complete JSON. No markdown fencing (```json) around the response. CRITICAL: The JSON must be complete and properly closed with all closing braces. Do not truncate the JSON response.
5.  **JSON STRING ESCAPING (CRITICAL - read carefully):** The HTML you write goes inside a JSON string value. EVERY double quote character inside that HTML MUST be escaped as \" - for example write <table class=\"editor-table\"> and <a href=\"/en/quote\">, NOT <table class="editor-table">. A single unescaped double quote anywhere in the content invalidates the entire response and the article is discarded. If you are unsure, prefer single quotes for HTML attributes (e.g. <table class='editor-table'>), which need no escaping at all.

---
### EUROPEAN LOCALIZATION (MANDATORY)
**Target Audience: European manufacturers and engineers. Follow these rules strictly:**
1.  **Currency:** Always use Euro (€) for ALL prices. NEVER use Dollar ($). Example: "Starting from €500" not "$500".
2.  **Measurements:** Use METRIC ONLY - centimeters (cm) and millimeters (mm). NEVER use inches or feet. Example: "tolerance of ±0.05 mm" not "±0.002 inches".
3.  **Decimal Notation:** Use comma for decimals in measurements when contextually appropriate (e.g., "2,5 mm" is acceptable, but "2.5 mm" is also fine for technical content).
4.  **Weight:** Use kilograms (kg) and grams (g), NEVER pounds (lb) or ounces (oz).

---
### LINKING STRATEGY (Dynamic Insertion)
You must insert 4 specific types of links naturally into the flow of the text:
1.  **Silo Context Link:** Choose ONLY 1-2 relevant articles from this list (use the SAME number each time, do NOT accumulate):
${relatedArticles}
    Link to them using natural anchor text where the concept is mentioned. Use format: <a href='/en/blog/slug-here'>anchor text</a> (no extra spaces inside the link tag - spaces will be added automatically)
    CRITICAL: If there are 2 articles in the list, use exactly 1-2 links. Do NOT add more links than articles in the list. Do NOT accumulate links across articles.
2.  **Specific Service Page Link (ROTATION - MANDATORY):** You MUST include ONE link to the ${selectedService.name} service page. Find a natural place in the content where ${selectedService.name.toLowerCase()} or related manufacturing processes are discussed, and insert a natural link: <a href='${selectedService.url}'>${selectedService.anchor}</a> (no extra spaces inside the link tag - spaces will be added automatically).
3.  **General Service Page Link:** When mentioning manufacturing processes, link to the general service path using: <a href='/en/services'>our manufacturing services</a> (no extra spaces inside the link tag - spaces will be added automatically)
4.  **Commercial Intent (Quote - ROTATING TEXT):** Near the 60% mark of the article, insert a distinct, persuasive single-sentence paragraph with rotating text:
    * Use this exact format: "For high-precision results, <a href='/en/quote'>${selectedQuoteText}</a> from ${BRAND_NAME}." (no extra spaces inside the link tag - spaces will be added automatically)
    * CRITICAL: NEVER use the word "instant" or "immediately" in quote sentences. Use phrases like "within 24 hours", "in 24 hours", or "delivered in 24 hours" instead.

---
### CONTENT REQUIREMENTS
1.  **Length:** Minimum 2500 words of comprehensive, detailed technical content. Go deep into each topic with specific examples, use cases, technical specifications, and practical insights. Each section should be substantial (minimum 250-350 words per major section).
2.  **Depth & Detail:** 
    * Provide detailed explanations, not just surface-level information
    * Include specific technical values, ranges, and specifications
    * Explain the "why" behind recommendations, not just the "what"
    * Add practical examples and real-world applications
    * Include nuanced comparisons and trade-offs
3.  **Silo Category:** This article belongs to the "${siloCategory || 'General'}" content silo.
4.  **Structure:**
    * **DO NOT include an H1 title in the content** - the title is already provided and will be displayed separately. Start directly with the introduction paragraph or Executive Summary.
    * **Executive Summary:** A "Key Takeaways" bullet list (3-4 points) right after the intro using <ul><li> tags.
    * **Deep Dive (H2/H3):** Detailed process, tolerances, material selection, and cost drivers.
    * **Comparison Tables (MANDATORY):** 
      - ALWAYS create HTML tables (<table>) when comparing materials, processes, properties, specifications, or any data that benefits from side-by-side comparison.
      - Use tables for: material properties (tensile strength, hardness, cost), process comparisons (CNC vs 3D printing), tolerance ranges, pricing tiers, material grades, surface finish options, etc.
      - Format tables with proper HTML structure: <table class='editor-table'><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>
      - CRITICAL: Tables MUST be properly closed with </table> tag. Each <tr> must be closed with </tr>, each <td> with </td>, each <th> with </th>, <thead> with </thead>, <tbody> with </tbody>.
      - Include inline styles for borders and spacing if needed, but primary styling is via CSS classes.
      - Use <th> for header cells in <thead> section.
      - Use <td> for data cells in <tbody> section.
      - Make tables responsive and readable with proper column alignment.
      - NEVER break table structure - keep all table HTML tags intact and properly nested.
      - Example: When comparing aluminum 6061-T6 vs 7075-T6, create a table with columns for Property, 6061-T6, 7075-T6, and rows for Yield Strength, Tensile Strength, Hardness, Cost, etc.
    * **Visual Q&A:** A visible H2 section titled "Frequently Asked Questions" at the bottom with 5-7 questions using <h3> for each question.
4.  **FAQ Schema:** Generate Google-compliant JSON-LD for the FAQ section.
5.  **Microns Hub Benefits Paragraph (MANDATORY):** Near the 75% mark of the article, insert a dedicated paragraph (2-3 sentences) highlighting the advantages of ordering from ${BRAND_NAME} versus marketplaces. Mention benefits such as superior quality control, competitive pricing, direct manufacturer relationship, personalized service, and technical expertise. Make it natural and contextual to the article content. Example format: "When ordering from ${BRAND_NAME}, you benefit from direct manufacturer relationships that ensure superior quality control and competitive pricing compared to marketplace platforms. Our technical expertise and personalized service approach means every project receives the attention to detail it deserves."
6.  **Readability & Spacing:** 
    * Each paragraph should have proper spacing (wrap each in <p> tags).
    * Add a blank line/spacing between paragraphs for visual breathing room.
    * Keep paragraphs concise (3-5 sentences max) for better readability.
    * Use <br><br> between major sections if needed for visual separation.

---
### OUTPUT FORMAT (JSON - No markdown fencing!)
{
  "content": "<div class='blog-post'>...full HTML content with proper tags and spacing...</div>",
  "excerpt": "A 160-character technical summary optimized for CTR.",
  "metaTitle": "SEO Title (Max 60 chars) | ${BRAND_NAME}",
  "metaDescription": "SEO Description (Max 160 chars) with primary keyword.",
  "faqSchema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Question text here",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Answer text here"
        }
      }
    ]
  }
}