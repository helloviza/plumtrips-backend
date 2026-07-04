const config = require("../config/config");
const { formatINR } = require("../utils/priceCalculator");

function buildItineraryHtml({ slots, flight, hotel, combo, itinerary, heroImageUrl }) {
  const c = config.company;

  const daysHtml = itinerary.days
    .map(
      (day) => `
    <div class="day">
      <div class="day-badge">Day ${day.dayNumber}</div>
      <h3>${day.title} <span class="day-date">${day.date || ""}</span></h3>
      ${day.activities
        .map(
          (a) => `
        <div class="activity">
          <img src="${a.imageUrl}" alt="${a.description}" />
          <div class="activity-text">
            <div class="activity-time">${a.time}</div>
            <div>${a.description}</div>
          </div>
        </div>`
        )
        .join("")}
    </div>`
    )
    .join('<div class="divider"></div>');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2430; margin: 0; padding: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 28px 40px 10px; }
  .company-name { color: #1e3a8a; font-size: 26px; font-weight: 800; margin: 0; }
  .company-sub { color: #d97757; font-size: 13px; margin: 2px 0; font-weight: 600; }
  .company-addr { color: #667085; font-size: 12px; margin: 0; }
  .contact { text-align: right; font-size: 12px; color: #344054; }
  .hero { width: 100%; height: 260px; object-fit: cover; }
  .title-bar { display: flex; justify-content: space-between; align-items: center; padding: 18px 40px; }
  .trip-title { font-size: 22px; font-weight: 700; margin: 0; }
  .trip-meta { color: #667085; font-size: 13px; margin-top: 4px; }
  .price { font-size: 22px; font-weight: 800; color: #1e3a8a; }
  .section { padding: 10px 40px 26px; }
  .section h2 { font-size: 16px; border-bottom: 2px solid #eef0f4; padding-bottom: 8px; color: #1e3a8a; }
  .card { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid #f0f1f4; }
  .card img { width: 90px; height: 70px; object-fit: cover; border-radius: 6px; }
  .card-name { font-weight: 700; font-size: 14px; }
  .card-meta { font-size: 12px; color: #667085; margin-top: 3px; }
  .price-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  .price-table td { padding: 8px 4px; border-bottom: 1px solid #f0f1f4; }
  .price-table .total-row td { font-weight: 800; border-top: 2px solid #1e3a8a; border-bottom: none; font-size: 15px; }
  .day-badge { display: inline-block; background: #1e3a8a; color: #fff; font-size: 11px; padding: 3px 10px; border-radius: 999px; margin-bottom: 6px; }
  .day h3 { margin: 4px 0 10px; font-size: 15px; }
  .day-date { color: #98a2b3; font-weight: 400; font-size: 12px; }
  .activity { display: flex; gap: 12px; margin-bottom: 10px; }
  .activity img { width: 130px; height: 85px; object-fit: cover; border-radius: 8px; }
  .activity-time { font-size: 11px; font-weight: 700; color: #d97757; text-transform: uppercase; }
  .divider { border-top: 1px dashed #d0d5dd; margin: 14px 40px; }
  .summary { font-size: 13px; color: #475467; padding: 0 40px 14px; }
  .footer { background: #1e3a8a; color: #fff; text-align: center; padding: 14px; font-size: 13px; margin-top: 20px; }
  .overbudget-note { background: #fff4e5; border: 1px solid #f0b429; color: #7a4b00; padding: 10px 14px; border-radius: 8px; font-size: 12px; margin: 0 40px 16px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <p class="company-name">${c.name}</p>
      <p class="company-sub">${c.subtitle}</p>
      <p class="company-addr">${c.address}</p>
    </div>
    <div class="contact">
      📞 ${c.phone}<br/>
      ✉️ ${c.email}
    </div>
  </div>

  ${heroImageUrl ? `<img class="hero" src="${heroImageUrl}" />` : ""}

  <div class="title-bar">
    <div>
      <p class="trip-title">${itinerary.tripTitle}</p>
      <p class="trip-meta">📍 ${slots.destinationCity} &nbsp;|&nbsp; 📅 ${slots.departDate} → ${slots.returnDate} &nbsp;|&nbsp; 👥 ${slots.adults} Adult(s)${slots.children ? `, ${slots.children} Children` : ""}</p>
    </div>
    <div class="price">${formatINR(combo.total)}</div>
  </div>

  ${combo.overBudget ? `<div class="overbudget-note">⚠️ This is the cheapest available combination we found, but it is slightly above your stated budget of ${formatINR(slots.budgetINR)}.</div>` : ""}

  <div class="summary">${itinerary.summary}</div>

  <div class="section">
    <h2>Flight</h2>
    <div class="card">
      <div>
        <div class="card-name">${flight.airline} ${flight.flightNumber}</div>
        <div class="card-meta">${slots.originAirportCode} → ${slots.destinationAirportCode} &nbsp;|&nbsp; ${slots.departDate}</div>
        <div class="card-meta">${flight.stops === 0 ? "Non-stop" : `${flight.stops} stop(s)`}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Hotel</h2>
    <div class="card">
      ${hotel.image ? `<img src="${hotel.image}" />` : ""}
      <div>
        <div class="card-name">${hotel.name} ${hotel.starRating ? "★".repeat(Math.round(hotel.starRating)) : ""}</div>
        <div class="card-meta">${hotel.roomType} &nbsp;|&nbsp; ${hotel.mealPlan}</div>
        <div class="card-meta">${slots.departDate} → ${slots.returnDate}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Price Breakdown</h2>
    <table class="price-table">
      <tr><td>Flight (${slots.adults + slots.children} pax)</td><td style="text-align:right">${formatINR(combo.flightTotal)}</td></tr>
      <tr><td>Hotel (${hotel.roomType})</td><td style="text-align:right">${formatINR(combo.hotelTotal)}</td></tr>
      <tr class="total-row"><td>Total</td><td style="text-align:right">${formatINR(combo.total)}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Day-Wise Itinerary</h2>
    ${daysHtml}
  </div>

  <div class="footer">Thank you for planning your trip with ${c.name} — ${c.phone}</div>
</body>
</html>`;
}

module.exports = { buildItineraryHtml };
