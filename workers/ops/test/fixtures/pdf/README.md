# PDF fixtures (synthetic)

Made up for the tests with pdf-lib 1.17.1; no customer document.

| File | Content |
|---|---|
| `one-page.pdf` | 1 page of text |
| `seven-pages.pdf` | 7 pages of text (the trim step keeps pages 1-5) |
| `encrypted.pdf` | 2 pages with an `/Encrypt` dictionary in the trailer (reported as encrypted, never sent to a model) |
| `not-a-pdf.pdf` | plain text with a `.pdf` name (reported as unreadable) |
