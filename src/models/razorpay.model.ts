export type HotelPaymentOrderInput = {
  amountInr: number;
  currency?: string;
  bookingCode: string;
  traceId: string;
  hotelName?: string;
};

export type VerifyPaymentInput = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};


export type FlightPaymentOrderInput = {
  amountInr: number;
  currency?: string;
  bookingCode: string;
  traceId: string;
  flightRoute: string;
  flightDate?: string;
  passengerCount?: number;
};