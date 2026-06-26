// apps/backend/src/component/flight/ticketPdf.ts
// npm install pdfkit && npm install -D @types/pdfkit

import PDFDocument from "pdfkit";

// Accepts the raw TicketResponse shape exactly as TBO returns it
// (after your ticketFlight unwraps data.Response)
export function generateTicketPdf(ticket: Record<string, any>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const itin = ticket.FlightItinerary ?? {};
    const PW   = doc.page.width;
    const W    = PW - 80;
    const C    = W / 4;   // column width

    let y = 0;

    // ── colours ──────────────────────────────────────────────────────────────
    const BRAND   = "#1A56DB";
    const LIGHT   = "#F0F4FF";
    const DARK    = "#1E293B";
    const MUTED   = "#64748B";
    const WHITE   = "#FFFFFF";
    const DIV     = "#CBD5E1";

    const f = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

    const fDate = (raw: string | undefined | null) => {
      if (!raw || raw.startsWith("0001")) return "—";
      try {
        return new Date(raw).toLocaleDateString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit", hour12: false,
        });
      } catch { return raw; }
    };

    const fMoney = (v: unknown) => {
      const n = Number(v);
      return isNaN(n) ? "—" : `₹${n.toLocaleString("en-IN")}`;
    };

    const statusMap: Record<number, string> = {
      0: "FAILED", 1: "CONFIRMED", 2: "NOT SAVED", 3: "NOT CREATED",
      4: "NOT ALLOWED", 5: "IN PROGRESS", 6: "CONFIRMED", 8: "PRICE CHANGED", 9: "ERROR",
    };
    const statusColorMap: Record<number, string> = {
      1: "#16A34A", 6: "#16A34A", 5: "#D97706", 8: "#D97706",
    };

    const ts = ticket.TicketStatus ?? itin.Status ?? 0;

    // ── HEADER ───────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 80).fill(BRAND);
    doc.fillColor(WHITE).fontSize(20).font("Helvetica-Bold")
       .text("FLIGHT E-TICKET", 40, 18, { width: 320 });
    doc.fontSize(9).font("Helvetica")
       .text(`Booking ID : ${f(itin.BookingId ?? ticket.BookingId)}`, 40, 44)
       .text(`PNR        : ${f(itin.PNR ?? ticket.PNR)}`, 40, 56)
       .text(`Invoice    : ${f(itin.InvoiceNo)}`, 40, 68);

    // status badge
    const badgeColor = statusColorMap[ts] ?? "#DC2626";
    doc.roundedRect(PW - 160, 24, 120, 28, 4).fill(badgeColor);
    doc.fillColor(WHITE).fontSize(10).font("Helvetica-Bold")
       .text(statusMap[ts] ?? "UNKNOWN", PW - 160, 34, { width: 120, align: "center" });

    y = 96;

    // ── helpers ───────────────────────────────────────────────────────────────
    const bar = (title: string) => {
      doc.rect(40, y, W, 20).fill(BRAND);
      doc.fillColor(WHITE).fontSize(9).font("Helvetica-Bold")
         .text(title, 48, y + 5, { width: W - 16 });
      y += 26;
    };

    const kv = (label: string, value: string, x: number, w: number) => {
      doc.fillColor(MUTED).fontSize(7).font("Helvetica")
         .text(label.toUpperCase(), x, y, { width: w });
      doc.fillColor(DARK).fontSize(8.5).font("Helvetica-Bold")
         .text(value, x, y + 9, { width: w });
    };

    const row4 = (
      a: [string, string], b: [string, string],
      c: [string, string], d: [string, string],
    ) => {
      kv(a[0], a[1], 40,         C - 6);
      kv(b[0], b[1], 40 + C,     C - 6);
      kv(c[0], c[1], 40 + C * 2, C - 6);
      kv(d[0], d[1], 40 + C * 3, C - 6);
      y += 28;
    };

    const div = () => {
      y += 3;
      doc.moveTo(40, y).lineTo(40 + W, y).strokeColor(DIV).lineWidth(0.5).stroke();
      y += 8;
    };

    // ═══ 1. FLIGHT SUMMARY ═══════════════════════════════════════════════════
    bar("FLIGHT SUMMARY");
    row4(
      ["From",        `${f(itin.Origin)}`],
      ["To",          `${f(itin.Destination)}`],
      ["Airline",     `${f(itin.AirlineCode)} (${f(itin.ValidatingAirlineCode)})`],
      ["Fare Type",   f(itin.FareType)],
    );
    row4(
      ["Is Domestic",  itin.IsDomestic ? "Yes" : "No"],
      ["Non-Refund",   itin.NonRefundable ? "Yes" : "No"],
      ["Is LCC",       itin.IsLCC ? "Yes" : "No"],
      ["Fare Class",   f(itin.SupplierFareClasses ?? itin.FareClassification)],
    );
    row4(
      ["Invoice No",   f(itin.InvoiceNo)],
      ["Invoice Date", fDate(itin.InvoiceCreatedOn)],
      ["Invoice Amt",  fMoney(itin.InvoiceAmount)],
      ["TBO Conf No",  f(itin.TBOConfNo)],
    );
    if (itin.AirlineRemark) {
      doc.fillColor(MUTED).fontSize(7.5).font("Helvetica-Oblique")
         .text(`Airline Remark: ${itin.AirlineRemark}`, 40, y, { width: W });
      y += 14;
    }
    div();

    // ═══ 2. FARE BREAKDOWN ═══════════════════════════════════════════════════
    const fare = itin.Fare ?? {};
    bar("FARE DETAILS");
    row4(
      ["Base Fare",   fMoney(fare.BaseFare)],
      ["Tax",         fMoney(fare.Tax)],
      ["YQ Tax",      fMoney(fare.YQTax)],
      ["Other Chrgs", fMoney(fare.OtherCharges)],
    );
    row4(
      ["Published",   fMoney(fare.PublishedFare)],
      ["Offered",     fMoney(fare.OfferedFare)],
      ["Discount",    fMoney(fare.Discount)],
      ["Currency",    f(fare.Currency)],
    );

    // Tax breakup inline
    if (Array.isArray(fare.TaxBreakup) && fare.TaxBreakup.length > 0) {
      const taxLine = fare.TaxBreakup
        .filter((t: any) => t.key !== "TotalTax" && t.value > 0)
        .map((t: any) => `${t.key}: ₹${t.value}`)
        .join("  |  ");
      doc.fillColor(MUTED).fontSize(7.5).font("Helvetica")
         .text(`Tax Breakup: ${taxLine}`, 40, y, { width: W });
      y += 14;
    }
    div();

    // ═══ 3. PASSENGERS ═══════════════════════════════════════════════════════
    bar("PASSENGER DETAILS");

    const passengers: any[] = Array.isArray(itin.Passenger) ? itin.Passenger : [];

    passengers.forEach((pax: any, idx: number) => {
      // page break if needed
      if (y > doc.page.height - 200) { doc.addPage(); y = 40; }

      doc.rect(40, y - 2, W, 130).fill(idx % 2 === 0 ? LIGHT : WHITE);

      const paxTypeLabel = pax.PaxType === 1 ? "Adult" : pax.PaxType === 2 ? "Child" : "Infant";
      doc.fillColor(BRAND).fontSize(9).font("Helvetica-Bold")
         .text(
           `${idx + 1}.  ${f(pax.Title)} ${f(pax.FirstName)} ${f(pax.LastName)}  (${paxTypeLabel})`,
           44, y, { width: W - 8 }
         );
      y += 14;

      // Ticket info
      const tk = pax.Ticket ?? {};
      row4(
        ["Ticket No",    f(tk.TicketNumber)],
        ["Issue Date",   fDate(tk.IssueDate)],
        ["Status",       f(tk.Status)],
        ["Validating",   f(tk.ValidatingAirline)],
      );

      // Passenger info
      row4(
        ["Gender",        pax.Gender === 1 ? "Male" : "Female"],
        ["Nationality",   f(pax.Nationality)],
        ["Contact",       f(pax.ContactNo)],
        ["Email",         f(pax.Email)],
      );

      // Passport
      if (pax.PassportNo) {
        row4(
          ["Passport No",  f(pax.PassportNo)],
          ["Expiry",       fDate(pax.PassportExpiry)],
          ["PAN",          f(pax.PAN)],
          ["Lead Pax",     pax.IsLeadPax ? "Yes" : "No"],
        );
      }

      // SegmentAdditionalInfo — it's an ARRAY in the real response
      const segInfo = Array.isArray(pax.SegmentAdditionalInfo)
        ? pax.SegmentAdditionalInfo[0]
        : (pax.SegmentAdditionalInfo ?? {});

      row4(
        ["Fare Basis", f(segInfo.FareBasis)],
        ["Baggage",    f(segInfo.Baggage)],
        ["Meal",       f(segInfo.Meal)],
        ["Cabin Bag",  f(segInfo.CabinBaggage) === "—" ? "As per fare" : f(segInfo.CabinBaggage)],
      );

      // Pax fare
      const paxFare = pax.Fare ?? {};
      if (paxFare.OfferedFare !== undefined) {
        const fc = W / 5;
        doc.fillColor(MUTED).fontSize(7).font("Helvetica-Bold").text("PAX FARE", 44, y);
        y += 10;
        [
          ["Base", paxFare.BaseFare],
          ["Tax",  paxFare.Tax],
          ["YQ",   paxFare.YQTax],
          ["Other",paxFare.OtherCharges],
          ["Total",paxFare.OfferedFare],
        ].forEach(([label, val], fi) => {
          kv(String(label), fMoney(val), 44 + fi * fc, fc - 4);
        });
        y += 28;
      }

      // Meal add-ons
      const meals: any[] = Array.isArray(pax.MealDynamic) ? pax.MealDynamic.filter((m: any) => m.Code !== "NoMeal") : [];
      if (meals.length > 0) {
        doc.fillColor(MUTED).fontSize(7).font("Helvetica-Bold").text("MEAL", 44, y);
        y += 10;
        meals.forEach((m: any) => {
          doc.fillColor(DARK).fontSize(8).font("Helvetica")
             .text(`${f(m.Code)}  ${f(m.AirlineDescription)}  (${f(m.Origin)}→${f(m.Destination)})  ₹${m.Price ?? 0}`, 44, y, { width: W - 8 });
          y += 11;
        });
        y += 4;
      }

      // Baggage add-ons
      const bags: any[] = Array.isArray(pax.Baggage) ? pax.Baggage.filter((b: any) => b.Code !== "NoBaggage" && b.Weight > 0) : [];
      if (bags.length > 0) {
        doc.fillColor(MUTED).fontSize(7).font("Helvetica-Bold").text("EXTRA BAGGAGE", 44, y);
        y += 10;
        bags.forEach((b: any) => {
          doc.fillColor(DARK).fontSize(8).font("Helvetica")
             .text(`${b.Weight}kg  (${f(b.Origin)}→${f(b.Destination)})  ₹${b.Price ?? 0}`, 44, y, { width: W - 8 });
          y += 11;
        });
        y += 4;
      }

      y += 6;
    });

    div();

    // ═══ 4. SEGMENTS ═════════════════════════════════════════════════════════
    const segments: any[] = Array.isArray(itin.Segments) ? itin.Segments : [];
    if (segments.length > 0) {
      if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
      bar("FLIGHT SEGMENTS");

      segments.forEach((seg: any, idx: number) => {
        doc.rect(40, y - 2, W, 58).fill(idx % 2 === 0 ? LIGHT : WHITE);

        const orig = seg.Origin ?? {};
        const dest = seg.Destination ?? {};
        const apt  = (x: any) => x.Airport ?? {};

        doc.fillColor(BRAND).fontSize(9).font("Helvetica-Bold")
           .text(
             `${f(apt(orig).AirportCode)} → ${f(apt(dest).AirportCode)}  |  ${f(seg.Airline?.AirlineCode)}-${f(seg.Airline?.FlightNumber)}  |  ${f(seg.Airline?.AirlineName)}`,
             44, y
           );
        y += 13;

        row4(
          ["Departure",  fDate(orig.DepTime)],
          ["Arrival",    fDate(dest.ArrTime)],
          ["Duration",   `${Math.floor((seg.Duration ?? 0) / 60)}h ${(seg.Duration ?? 0) % 60}m`],
          ["Craft",      f(seg.Craft)],
        );
        row4(
          ["From",       `${f(apt(orig).CityName)} T-${f(apt(orig).Terminal)}`],
          ["To",         `${f(apt(dest).CityName)} T-${f(apt(dest).Terminal)}`],
          ["Fare Class", f(seg.Airline?.FareClass)],
          ["Status",     f(seg.FlightStatus)],
        );
      });

      div();
    }

    // ═══ 5. FARE RULES (brief) ═══════════════════════════════════════════════
    const miniFare: any[] = Array.isArray(itin.MiniFareRules) ? itin.MiniFareRules : [];
    if (miniFare.length > 0) {
      if (y > doc.page.height - 100) { doc.addPage(); y = 40; }
      bar("CANCELLATION & CHANGE FEES");

      miniFare.forEach((rule: any) => {
        const window = rule.To
          ? `${rule.From}${rule.Unit === "HOURS" ? "h" : "d"} – ${rule.To}${rule.Unit === "HOURS" ? "h" : "d"}`
          : `${rule.From}${rule.Unit === "HOURS" ? "h" : "d"}+`;
        doc.fillColor(DARK).fontSize(8).font("Helvetica")
           .text(`${f(rule.Type)}  |  ${window}  |  ${f(rule.JourneyPoints)}  →  ${f(rule.Details)}`, 44, y, { width: W - 8 });
        y += 13;
      });

      div();
    }

    // ═══ 6. FOOTER ═══════════════════════════════════════════════════════════
    const ph = doc.page.height;
    doc.rect(0, ph - 32, PW, 32).fill(BRAND);
    doc.fillColor(WHITE).fontSize(7.5).font("Helvetica")
       .text(
         `Generated: ${new Date().toLocaleString("en-IN")}  •  System-generated e-ticket  •  PlumTrips`,
         40, ph - 20, { width: W, align: "center" }
       );

    doc.end();
  });
}