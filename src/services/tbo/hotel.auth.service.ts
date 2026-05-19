// src/services/tbo/hotel.auth.service.ts
//
// TBO Hotel API — Authorization
//
// Per https://apidoc.tektravels.com/hotelnew/Authorization.aspx:
//
//  Static API  (CountryList, CityList, HotelDetails, HotelCodes, TBOHotelCodeList)
//    → Basic Auth header: TBOStaticAPITest : Tbo@11530818
//
//  Booking API (Search, PreBook, Book, GetBookingDetails, CancelBooking)
//    → Basic Auth header: <agency username> : <agency password>
//    → JSON body must also include TokenId from POST /Authenticate (SharedData.svc)
//      and TraceId (same value for the whole search → prebook → book flow).
//
// Shared /Authenticate uses the same ClientId / UserName / Password / EndUserIp as flights.

// ── Static API credentials ────────────────────────────────────────────────────

export function getStaticCredentials() {
  return {
    UserName: String(process.env.TBO_HOTEL_STATIC_USERNAME || "TBOStaticAPITest").trim(),
    Password: String(process.env.TBO_HOTEL_STATIC_PASSWORD || "Tbo@11530818").trim(),
  };
}

/** Basic Auth header for the TBO Hotel Static API */
export function getStaticAuthHeader(): string {
  const { UserName, Password } = getStaticCredentials();
  return `Basic ${Buffer.from(`${UserName}:${Password}`).toString("base64")}`;
}

// ── Booking API credentials ───────────────────────────────────────────────────

export function getBookingCredentials() {
  return {
    UserName: String(process.env.TBO_UserName || process.env.TBO_USERNAME || "").trim(),
    Password: String(process.env.TBO_Password || process.env.TBO_PASSWORD || "").trim(),
  };
}

/** Basic Auth header for the TBO Hotel Booking API (Search / PreBook / Book) */
export function getBookingAuthHeader(): string {
  const { UserName, Password } = getBookingCredentials();
  if (!UserName || !Password) {
    throw new Error("TBO hotel booking credentials not configured (TBO_UserName / TBO_Password)");
  }
  return `Basic ${Buffer.from(`${UserName}:${Password}`).toString("base64")}`;
}
