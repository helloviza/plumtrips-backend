export function generateHotelVoucherHtml(booking: any): string {
  const fmt = (d: Date | string | undefined) => {
    if (!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Asia/Kolkata"
    });
  };

  const nights = booking.checkIn && booking.checkOut
    ? Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86_400_000)
    : 0;

  const travelersCount = (booking.guests?.length ?? 1) + " Traveler" + ((booking.guests?.length ?? 1) > 1 ? "s" : "");

  const rooms: any[] = booking.rooms ?? [];
  const packageName = rooms.length > 0
    ? rooms.map((r: any) => `${r.quantity ?? 1}× ${r.name ?? r.type ?? "Room"}`).join(", ")
    : "1× Room";

  // Dummy inclusions or take from rooms
  const inclusions = [
    "Accommodation in selected room category",
    "All applicable taxes and fees",
    booking.priceDetails?.additionalCharges ? "Includes additional property charges" : null,
  ].filter(Boolean) as string[];

  const inclusionsHtml = inclusions.map(inc => `<li>${inc}</li>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Vacation Order Confirmation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; background-color: #eef0f3; font-family: 'Outfit', Arial, sans-serif; }
    table { border-spacing: 0; border-collapse: collapse; }
  </style>
</head>
<body style="background-color: #eef0f3; margin: 0; padding: 24px 0;">
  <center>
    <table width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; width: 560px; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); background:#ffffff;">

      <!-- ═══ HEADER ═══ --> 
      <tr>
        <td style="background-color: #0c1a32; background-image: url('https://plumtrips-assets.s3.ap-south-1.amazonaws.com/email/viaductk-celebration-19390_512.gif'); background-repeat: no-repeat; background-position: center top; background-size: cover; padding: 36px 32px 20px 32px; text-align: center;">
          <!-- Logo -->
          <img src="https://plumtrips-assets.s3.ap-south-1.amazonaws.com/email/plumtrips-email-logo.png" width="200" style="display: block; margin: 0 auto 0 auto;">
          <!-- Heading -->
          <h1 style="font-family: 'Playfair Display', serif; color: #ffffff; font-size: 26px; font-weight: 700; margin: 0 0 5px 0; line-height: 1.2;">Your Vacation is Confirmed! ✨</h1>
          <!-- Order ID pill -->
          <div style="display: inline-block; background: #fef3e2; border: 1.5px solid #f97316; border-radius: 20px; padding: 6px 22px; margin-bottom: 10px;">
            <p style="margin: 0; color: #0c1a32; font-size: 12px; font-weight: 700; letter-spacing: 0.4px;">Order ID: ${booking.pnr}</p>
          </div>
          <!-- Sub-text -->
          <p style="color: #94a3b8; font-size: 12.5px; line-height: 1.5; margin: 0 auto 18px auto; max-width: 340px;">Thank you for trusting PlumTrips. We've received your order and are doing the magic behind the scenes.</p>
        </td>
      </tr>

      <!-- ═══ HERO IMAGE (flush — no gap) ═══ -->
      <tr>
        <td style="padding: 0; margin: 0; line-height: 0; background-color: #0c1a32;">
          <img src="https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?ixlib=rb-4.0.3&w=560&q=80"
               alt="Sunset Resort"
               width="560"
               style="display: block; width: 100%; height: 148px; object-fit: cover; border-radius: 0;">
        </td>
      </tr>

      <!-- ═══ DETAILS ═══ -->
      <tr>
        <td style="padding: 28px 32px 20px 32px; background-color: #ffffff;">
          <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Destination -->
            <tr>
              <td width="42" valign="top" style="padding-bottom: 14px;">
                <div style="width: 32px; height: 32px; border: 1.5px solid #f97316; border-radius: 50%; text-align: center; line-height: 30px; font-size: 14px;">📍</div>
              </td>
              <td valign="top" style="padding-bottom: 14px;">
                <p style="margin: 0 0 3px 0; font-size: 12px; font-weight: 700; color: #0c1a32; text-transform: uppercase; letter-spacing: 0.3px;">Destination</p>
                <p style="margin: 0; font-size: 13px; color: #475569;">${booking.hotelName ?? booking.location ?? "—"}</p>
              </td>
            </tr>

            <!-- Travel Dates -->
            <tr>
              <td width="42" valign="top" style="padding-bottom: 14px;">
                <div style="width: 32px; height: 32px; border: 1.5px solid #f97316; border-radius: 50%; text-align: center; line-height: 30px; font-size: 14px;">📅</div>
              </td>
              <td valign="top" style="padding-bottom: 14px;">
                <p style="margin: 0 0 3px 0; font-size: 12px; font-weight: 700; color: #0c1a32; text-transform: uppercase; letter-spacing: 0.3px;">Travel Dates</p>
                <p style="margin: 0; font-size: 13px; color: #475569;">${fmt(booking.checkIn)} – ${fmt(booking.checkOut)} &nbsp;(${nights} Nights)</p>
              </td>
            </tr>

            <!-- Travelers -->
            <tr>
              <td width="42" valign="top" style="padding-bottom: 14px;">
                <div style="width: 32px; height: 32px; border: 1.5px solid #f97316; border-radius: 50%; text-align: center; line-height: 30px; font-size: 14px;">👤</div>
              </td>
              <td valign="top" style="padding-bottom: 14px;">
                <p style="margin: 0 0 3px 0; font-size: 12px; font-weight: 700; color: #0c1a32; text-transform: uppercase; letter-spacing: 0.3px;">Travelers</p>
                <p style="margin: 0; font-size: 13px; color: #475569;">${travelersCount}</p>
              </td>
            </tr>

            <!-- Package -->
            <tr>
              <td width="42" valign="top" style="padding-bottom: 14px;">
                <div style="width: 32px; height: 32px; border: 1.5px solid #f97316; border-radius: 50%; text-align: center; line-height: 30px; font-size: 14px;">🎁</div>
              </td>
              <td valign="top" style="padding-bottom: 14px;">
                <p style="margin: 0 0 3px 0; font-size: 12px; font-weight: 700; color: #0c1a32; text-transform: uppercase; letter-spacing: 0.3px;">Package</p>
                <p style="margin: 0; font-size: 13px; color: #475569;">${packageName}</p>
              </td>
            </tr>

            <!-- Inclusions -->
            <tr>
              <td width="42" valign="top">
                <div style="width: 32px; height: 32px; border: 1.5px solid #f97316; border-radius: 50%; text-align: center; line-height: 30px; font-size: 14px;">📋</div>
              </td>
              <td valign="top">
                <p style="margin: 0 0 5px 0; font-size: 12px; font-weight: 700; color: #0c1a32; text-transform: uppercase; letter-spacing: 0.3px;">Inclusions</p>
                <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #64748b; line-height: 1.6;">
                  ${inclusionsHtml}
                </ul>
              </td>
            </tr>

          </table>
        </td>
      </tr>

      <!-- ═══ WHAT'S NEXT ═══ -->
      <tr style="page-break-inside: avoid;">
        <td style="padding: 0 32px 16px 32px; background-color: #ffffff;">
          <div style="background-color: #fdf8f3; border-radius: 8px; padding: 14px 18px;">
            <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 700; color: #0c1a32;">What's Next?</p>
            <p style="margin: 0; font-size: 12px; color: #475569; line-height: 1.5;">You will receive a detailed itinerary and all trip documents within 24 hours.</p>
          </div>
        </td>
      </tr>

      <!-- ═══ MANAGE BOOKING ═══ -->
      <tr style="page-break-inside: avoid;">
        <td style="padding: 0 32px 20px 32px; background-color: #ffffff;">
          <div style="background-color: #0c1a32; border-radius: 8px; padding: 20px 24px; text-align: center;">
            <p style="margin: 0 0 3px 0; font-size: 14px; font-weight: 700; color: #ffffff;">Manage Your Booking</p>
            <p style="margin: 0 0 12px 0; font-size: 12px; color: #94a3b8;">View itinerary, make changes, and more.</p>
            <a href="https://plumtrips.com/account/profile" style="display: inline-block; background-color: #f97316; color: #ffffff; padding: 9px 0; border-radius: 6px; font-size: 13px; font-weight: 600; text-decoration: none; width: 200px;">Go to My Booking</a>
          </div>
        </td>
      </tr>

      <!-- ═══ NEED HELP ═══ -->
      <tr style="page-break-inside: avoid;">
        <td style="padding: 0 32px 20px 32px; background-color: #ffffff;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 0;">
            <tr>
              <td width="36" valign="middle" style="padding-right: 12px; font-size: 22px; padding-top: 16px;">🎧</td>
              <td valign="middle" style="padding-top: 16px;">
                <p style="margin: 0 0 2px 0; font-size: 13px; font-weight: 700; color: #0c1a32;">Need Help?</p>
                <p style="margin: 0 0 3px 0; font-size: 11.5px; color: #64748b;">Reach out to our concierge team anytime.</p>
                <p style="margin: 0; font-size: 11.5px; font-weight: 600; color: #0c1a32;">📞 +91 98765 43210 &nbsp;|&nbsp; ✉️ care@plumtrips.com</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ═══ FOOTER — features row ═══ -->
      <tr style="page-break-inside: avoid;">
        <td style="background-color: #0c1a32; padding: 14px 32px 10px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="color: #94a3b8; font-size: 10.5px; line-height: 1.4;"><span style="font-size:13px;">✔️</span><br>Personalized</td>
              <td align="center" style="color: #94a3b8; font-size: 10.5px; line-height: 1.4;"><span style="font-size:13px;">🛡️</span><br>Reliable</td>
              <td align="center" style="color: #94a3b8; font-size: 10.5px; line-height: 1.4;"><span style="font-size:13px;">🌟</span><br>Memorable</td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- copyright -->
      <tr style="page-break-inside: avoid;">
        <td style="background-color: #0c1a32; padding: 8px 32px 18px 32px; text-align: center; border-top: 1px solid #1e293b;">
          <p style="margin: 0; font-size: 10.5px; color: #64748b;">&copy; ${new Date().getFullYear()} PlumTrips. All rights reserved.</p>
        </td>
      </tr>

    </table>
  </center>
</body>
</html>`;
}
