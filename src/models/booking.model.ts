import mongoose, { Schema, Document } from 'mongoose';

// Mirrors TBOBookResponse.Response.FlightItinerary + extra fields
const BookingSchema = new Schema({
  bookingId:    { type: Number, required: true, unique: true },
  pnr:          { type: String, required: true },
  userId:       { type: String },                        // attach to user if auth exists
  contactEmail: { type: String, required: true },
  contactPhone: { type: String },
  totalPaid:    { type: Number },
  isDomestic:   { type: Boolean },
  status:       { type: String, enum: ['confirmed', 'cancelled', 'pending'], default: 'confirmed' },
  flightItinerary: { type: Schema.Types.Mixed },         // full TBO FlightItinerary blob
  passengers:   [{ type: Schema.Types.Mixed }],          // TBOBookPassenger[]
  fare:         { type: Schema.Types.Mixed },            // TBOFare
  segments:     { type: Schema.Types.Mixed },            // TBOFlightSegment[][]
  rawResponse:  { type: Schema.Types.Mixed },            // full TBO response for debugging
}, { timestamps: true });

export const BookingModel = mongoose.model<Document & { bookingId: number }>(
  'Booking', BookingSchema
);