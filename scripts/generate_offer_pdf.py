"""
Professional offer PDF for Fahrzeugbau MEIER GmbH
Microns Hub DV E.E. - RFQ-08052026-1
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER, TA_JUSTIFY

# Brand colors (matching Microns Hub logo)
TEAL = colors.HexColor("#1FB8B8")
TEAL_DARK = colors.HexColor("#179999")
TEAL_LIGHT = colors.HexColor("#E6F7F7")
DARK = colors.HexColor("#2A2A2A")
GREY_TXT = colors.HexColor("#555555")
GREY_LINE = colors.HexColor("#D8D8D8")
GREY_BG = colors.HexColor("#F5F7F8")
GREY_TBL_HEAD = colors.HexColor("#2A2A2A")

OUTPUT = "/home/claude/RFQ-08052026-1.pdf"
LOGO = "/home/claude/microns_logo_clean.png"


# ---------- Page background (top accent bar + footer) ----------
def page_decorations(canv, doc):
    width, height = A4
    canv.saveState()

    # Top accent bar (teal)
    canv.setFillColor(TEAL)
    canv.rect(0, height - 8 * mm, width, 8 * mm, fill=1, stroke=0)

    # Thin dark stripe under accent bar
    canv.setFillColor(DARK)
    canv.rect(0, height - 9 * mm, width, 1 * mm, fill=1, stroke=0)

    # Footer band
    footer_h = 22 * mm
    canv.setFillColor(DARK)
    canv.rect(0, 0, width, footer_h, fill=1, stroke=0)
    # Teal accent in footer
    canv.setFillColor(TEAL)
    canv.rect(0, footer_h, width, 1.2 * mm, fill=1, stroke=0)

    # Footer text - 4 columns
    canv.setFillColor(colors.white)
    col_w = width / 4
    y_top = footer_h - 5 * mm
    line_h = 3.4 * mm

    def col(x, lines, header, body_size=6.8):
        canv.setFont("Helvetica-Bold", 7)
        canv.setFillColor(TEAL)
        canv.drawString(x, y_top, header)
        canv.setFillColor(colors.white)
        canv.setFont("Helvetica", body_size)
        for i, ln in enumerate(lines):
            canv.drawString(x, y_top - (i + 1) * line_h, ln)

    col(12 * mm, [
        "MICRONS HUB DV E.E.",
        "Industrial Area Street B No. 4",
        "71601 Heraklion, Greece",
    ], "COMPANY")

    col(12 * mm + col_w, [
        "Greece",
        "VAT ID: EL803129638",
        "GEMI: 169893827000",
    ], "TRADE REGISTER")

    col(12 * mm + 2 * col_w, [
        "Dimitris Vardalachakis",
        "Founder & Managing Director",
        "info@micronshub.eu",
    ], "MANAGEMENT")

    col(12 * mm + 3 * col_w, [
        "National Bank of Greece",
        "GR49 0110 2040 0000 2040 0891 170",
        "SWIFT/BIC: ETHNGRAA",
    ], "BANK ACCOUNT", body_size=6.0)

    # Page number (right top under accent bar)
    canv.setFillColor(GREY_TXT)
    canv.setFont("Helvetica", 8)
    canv.drawRightString(width - 15 * mm, height - 15 * mm, f"Page {doc.page}")

    canv.restoreState()


# ---------- Styles ----------
styles = getSampleStyleSheet()
st_normal = ParagraphStyle(
    "n", parent=styles["Normal"], fontName="Helvetica", fontSize=9, leading=12,
    textColor=DARK,
)
st_small = ParagraphStyle(
    "small", parent=st_normal, fontSize=8, leading=10, textColor=GREY_TXT,
)
st_label = ParagraphStyle(
    "label", parent=st_normal, fontName="Helvetica-Bold", fontSize=7.5,
    leading=9, textColor=TEAL, spaceAfter=2,
)
st_h_company = ParagraphStyle(
    "hc", parent=st_normal, fontName="Helvetica-Bold", fontSize=11,
    leading=13, textColor=DARK, alignment=TA_RIGHT,
)
st_h_company_sub = ParagraphStyle(
    "hcs", parent=st_normal, fontSize=8.5, leading=11, textColor=GREY_TXT,
    alignment=TA_RIGHT,
)
st_offer_title = ParagraphStyle(
    "ot", parent=st_normal, fontName="Helvetica-Bold", fontSize=22,
    leading=26, textColor=DARK, alignment=TA_LEFT, spaceAfter=2,
)
st_offer_sub = ParagraphStyle(
    "os", parent=st_normal, fontSize=9, leading=11, textColor=TEAL,
    alignment=TA_LEFT, fontName="Helvetica-Bold", spaceAfter=4,
)
st_section = ParagraphStyle(
    "sec", parent=st_normal, fontName="Helvetica-Bold", fontSize=10,
    leading=12, textColor=DARK, spaceBefore=4, spaceAfter=4,
)
st_buyer_name = ParagraphStyle(
    "bn", parent=st_normal, fontName="Helvetica-Bold", fontSize=10.5,
    leading=13, textColor=DARK,
)
st_meta_label = ParagraphStyle(
    "ml", parent=st_normal, fontSize=7.5, leading=9, textColor=GREY_TXT,
    alignment=TA_RIGHT, fontName="Helvetica-Bold",
)
st_meta_value = ParagraphStyle(
    "mv", parent=st_normal, fontSize=10, leading=12, textColor=DARK,
    alignment=TA_RIGHT, fontName="Helvetica-Bold",
)
st_intro = ParagraphStyle(
    "intro", parent=st_normal, fontSize=9.5, leading=13, textColor=DARK,
    spaceBefore=4, spaceAfter=4,
)
st_cell = ParagraphStyle(
    "cell", parent=st_normal, fontSize=8.5, leading=11, textColor=DARK,
)
st_cell_b = ParagraphStyle(
    "cellb", parent=st_cell, fontName="Helvetica-Bold",
)
st_cell_small = ParagraphStyle(
    "cells", parent=st_cell, fontSize=7.5, leading=9, textColor=GREY_TXT,
)
st_cell_price = ParagraphStyle(
    "cellp", parent=st_cell, fontSize=10, leading=12, textColor=DARK,
    fontName="Helvetica-Bold", alignment=TA_CENTER,
)
st_cell_qty = ParagraphStyle(
    "cellq", parent=st_cell, alignment=TA_CENTER,
)
st_th = ParagraphStyle(
    "th", parent=st_normal, fontSize=8.5, leading=10, textColor=colors.white,
    fontName="Helvetica-Bold", alignment=TA_CENTER,
)
st_th_l = ParagraphStyle(
    "thl", parent=st_th, alignment=TA_LEFT,
)
st_cond_h = ParagraphStyle(
    "ch", parent=st_normal, fontName="Helvetica-Bold", fontSize=8,
    leading=10, textColor=TEAL,
)
st_cond_v = ParagraphStyle(
    "cv", parent=st_normal, fontSize=9.5, leading=12, textColor=DARK,
    fontName="Helvetica-Bold",
)
st_note = ParagraphStyle(
    "note", parent=st_normal, fontSize=8.5, leading=11, textColor=GREY_TXT,
    alignment=TA_JUSTIFY,
)
st_close = ParagraphStyle(
    "close", parent=st_normal, fontSize=9, leading=12, textColor=DARK,
)
st_sig = ParagraphStyle(
    "sig", parent=st_normal, fontName="Helvetica-Bold", fontSize=10,
    leading=12, textColor=DARK,
)


# ---------- Build content ----------
doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=15 * mm, rightMargin=15 * mm,
    topMargin=15 * mm, bottomMargin=26 * mm,
    title="Offer RFQ-08052026-1 - Microns Hub",
    author="Microns Hub DV E.E.",
    subject="Offer for Fahrzeugbau MEIER GmbH",
)

story = []

# ---- Header (logo + company info) ----
logo_img = Image(LOGO, width=55 * mm, height=10.8 * mm)

company_info = [
    Paragraph("MICRONS HUB DV E.E.", st_h_company),
    Paragraph(
        "Industrial Area Street B, No. 4<br/>"
        "71601 Heraklion, Crete, Greece<br/>"
        "Tel: +30 210 444 7830<br/>"
        "info@micronshub.eu &nbsp;&middot;&nbsp; www.micronshub.eu<br/>"
        "VAT ID: EL803129638",
        st_h_company_sub,
    ),
]

header_tbl = Table(
    [[logo_img, company_info]],
    colWidths=[80 * mm, None],
)
header_tbl.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
story.append(header_tbl)

# Divider
story.append(Spacer(1, 6))
story.append(Table(
    [[""]],
    colWidths=[180 * mm],
    rowHeights=[0.6],
    style=TableStyle([("LINEABOVE", (0, 0), (-1, 0), 1.2, TEAL)]),
))
story.append(Spacer(1, 8))

# ---- Offer title row + meta ----
title_block = [
    Paragraph("OFFER", st_offer_title),
    Paragraph("Quotation for sheet metal parts", st_offer_sub),
]

meta_tbl = Table([
    [Paragraph("OFFER NO.", st_meta_label), Paragraph("RFQ-08052026-1", st_meta_value)],
    [Paragraph("DATE", st_meta_label), Paragraph("2026-05-08", st_meta_value)],
    [Paragraph("INQUIRY DATE", st_meta_label), Paragraph("2026-05-08", st_meta_value)],
    [Paragraph("VALID UNTIL", st_meta_label), Paragraph("2026-05-22", st_meta_value)],
], colWidths=[28 * mm, 38 * mm])
meta_tbl.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 2),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ("BACKGROUND", (0, 0), (-1, -1), GREY_BG),
    ("LINEBELOW", (0, 0), (-1, -2), 0.4, GREY_LINE),
    ("BOX", (0, 0), (-1, -1), 0.6, GREY_LINE),
]))

title_row = Table(
    [[title_block, meta_tbl]],
    colWidths=[114 * mm, 66 * mm],
)
title_row.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
story.append(title_row)
story.append(Spacer(1, 8))

# ---- Buyer / Supplier blocks ----
buyer_content = [
    Paragraph("BILL TO", st_label),
    Paragraph("Fahrzeugbau MEIER GmbH", st_buyer_name),
    Paragraph(
        "Attn: Mr. Thomas Hubert<br/>"
        "Supply Chain / Processes<br/>"
        "&Auml;u&szlig;ere Fischbacher Stra&szlig;e 20<br/>"
        "90518 Altdorf, Germany<br/>"
        "Tel: +49 9187 / 908978-46<br/>"
        "t.hubert@fahrzeugbau-meier.de",
        st_normal,
    ),
]

supplier_content = [
    Paragraph("SUPPLIED BY", st_label),
    Paragraph("Microns Hub DV E.E.", st_buyer_name),
    Paragraph(
        "Attn: Mr. Dimitris Vardalachakis<br/>"
        "Founder &amp; Managing Director<br/>"
        "Industrial Area Street B, No. 4<br/>"
        "71601 Heraklion, Crete, Greece<br/>"
        "Tel: +30 210 444 7830<br/>"
        "info@micronshub.eu",
        st_normal,
    ),
]

addr_tbl = Table(
    [[buyer_content, supplier_content]],
    colWidths=[90 * mm, 90 * mm],
)
addr_tbl.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("BACKGROUND", (0, 0), (0, 0), GREY_BG),
    ("BACKGROUND", (1, 0), (1, 0), TEAL_LIGHT),
    ("BOX", (0, 0), (0, 0), 0.6, GREY_LINE),
    ("BOX", (1, 0), (1, 0), 0.6, TEAL),
]))
story.append(addr_tbl)
story.append(Spacer(1, 8))

# ---- Intro paragraph ----
story.append(Paragraph("Dear Mr. Hubert,", st_intro))
story.append(Paragraph(
    "Thank you for your inquiry of 8 May 2026. Following our discussion with "
    "Mr. Meier, we are pleased to submit the following quotation for the five "
    "sheet metal parts listed in your request, including tiered pricing for "
    "quantities of 50, 100 and 200 units per part.",
    st_intro,
))
story.append(Spacer(1, 6))

# ---- Items table with tiered pricing ----
def th(text):
    return Paragraph(text, st_th)


def th_l(text):
    return Paragraph(text, st_th_l)


# Same per-piece price across tiers (per user instruction)
parts = [
    ("1", "BC020046", "U-Profil 75 mm",            "Sheet metal fabrication", "15.00", "15.00", "15.00"),
    ("2", "BC010027", "HuStAn vo klein",           "Sheet metal fabrication", "50.00", "50.00", "50.00"),
    ("3", "BA030037", "HuStAn HPC BVA verst&auml;rkt", "Sheet metal fabrication", "100.00", "100.00", "100.00"),
    ("4", "BA050013", "Korpus PuKi Standard",      "Sheet metal fabrication", "45.00", "45.00", "45.00"),
    ("5", "BA050014", "Deckel PuKi Standard",      "Sheet metal fabrication", "8.00", "8.00", "8.00"),
]

tbl_data = [
    [
        th_l("#"),
        th_l("PART NUMBER"),
        th_l("DESCRIPTION"),
        th_l("PROCESS"),
        th("Qty 50<br/>&euro;/piece"),
        th("Qty 100<br/>&euro;/piece"),
        th("Qty 200<br/>&euro;/piece"),
    ]
]

for row in parts:
    no, pn, desc, proc, p50, p100, p200 = row
    tbl_data.append([
        Paragraph(no, st_cell_qty),
        Paragraph(f"<b>{pn}</b>", st_cell),
        Paragraph(desc, st_cell),
        Paragraph(proc, st_cell_small),
        Paragraph(p50, st_cell_price),
        Paragraph(p100, st_cell_price),
        Paragraph(p200, st_cell_price),
    ])

items_tbl = Table(
    tbl_data,
    colWidths=[8 * mm, 28 * mm, 50 * mm, 30 * mm, 21 * mm, 21 * mm, 22 * mm],
    repeatRows=1,
)

tbl_style = [
    # Header
    ("BACKGROUND",    (0, 0), (-1, 0), DARK),
    ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
    ("ALIGN",         (0, 0), (3, 0), "LEFT"),
    ("ALIGN",         (4, 0), (-1, 0), "CENTER"),
    ("VALIGN",        (0, 0), (-1, 0), "MIDDLE"),
    ("TOPPADDING",    (0, 0), (-1, 0), 6),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
    ("LEFTPADDING",   (0, 0), (-1, -1), 6),
    ("RIGHTPADDING",  (0, 0), (-1, -1), 6),

    # Body
    ("VALIGN",        (0, 1), (-1, -1), "MIDDLE"),
    ("ALIGN",         (4, 1), (-1, -1), "CENTER"),
    ("ALIGN",         (0, 1), (0, -1), "CENTER"),
    ("TOPPADDING",    (0, 1), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
    ("LINEBELOW",     (0, 0), (-1, -1), 0.4, GREY_LINE),
    ("LINEBEFORE",    (4, 0), (4, -1), 0.6, TEAL),
]

# Zebra striping
for i in range(1, len(tbl_data)):
    if i % 2 == 0:
        tbl_style.append(("BACKGROUND", (0, i), (-1, i), GREY_BG))

# Highlight pricing block background
tbl_style.append(("BACKGROUND", (4, 1), (-1, -1), TEAL_LIGHT))

items_tbl.setStyle(TableStyle(tbl_style))
story.append(items_tbl)
story.append(Spacer(1, 4))

# ---- Pricing notes ----
story.append(Paragraph(
    "<b>Note on pricing:</b> Per-piece pricing is provided in EUR (&euro;), net of "
    "VAT. Pricing across the 50, 100 and 200 unit tiers is held flat as the "
    "production setup, tooling and material consumption for these parts do "
    "not deliver a meaningful unit-cost reduction at higher volumes within "
    "this range.",
    st_note,
))
story.append(Spacer(1, 6))


# ---- Conditions panel ----
def cond_cell(label, value):
    return [
        Paragraph(label, st_cond_h),
        Paragraph(value, st_cond_v),
    ]


cond_tbl = Table([
    [cond_cell("DELIVERY TIME", "21 working days"),
     cond_cell("INCOTERMS", "DAP &ndash; Altdorf"),
     cond_cell("PAYMENT TERMS", "14 days net"),
     cond_cell("OFFER VALIDITY", "14 days")],
], colWidths=[45 * mm, 45 * mm, 45 * mm, 45 * mm])
cond_tbl.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("BACKGROUND", (0, 0), (-1, -1), GREY_BG),
    ("LINEAFTER", (0, 0), (-2, -1), 0.6, GREY_LINE),
    ("BOX", (0, 0), (-1, -1), 0.6, GREY_LINE),
]))
story.append(cond_tbl)
story.append(Spacer(1, 6))

# ---- Notice box (intra-community supply) ----
notice = Table([[
    Paragraph(
        "<b>Intra-Community Supply (0% VAT):</b> This offer is issued as an "
        "intra-Community supply at 0% VAT, conditional on the buyer providing "
        "a valid VAT identification number prior to invoicing. All prices "
        "shown are net prices. For any clarification regarding this offer, "
        "please contact us at <b>+30 210 444 7830</b> or "
        "<b>info@micronshub.eu</b>.",
        st_note,
    )
]], colWidths=[180 * mm])
notice.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), TEAL_LIGHT),
    ("BOX", (0, 0), (-1, -1), 0.6, TEAL),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(notice)
story.append(Spacer(1, 6))

# ---- Closing ----
story.append(Paragraph(
    "We look forward to working with Fahrzeugbau MEIER GmbH and remain at "
    "your disposal for any technical or commercial questions regarding this "
    "quotation.",
    st_close,
))
story.append(Spacer(1, 6))
story.append(Paragraph("Mit freundlichen Gr&uuml;&szlig;en,", st_close))
story.append(Spacer(1, 2))
story.append(Paragraph("Dimitris Vardalachakis", st_sig))
story.append(Paragraph(
    "Founder &amp; Managing Director, Microns Hub DV E.E.",
    st_small,
))

# ---- Build ----
doc.build(story, onFirstPage=page_decorations, onLaterPages=page_decorations)
print(f"Created: {OUTPUT}")
