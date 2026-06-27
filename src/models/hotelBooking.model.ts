import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const GuestSchema = new Schema(
  {
    title: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    paxType: { type: Number, required: true }, // 1=Adult, 2=Child
    age: { type: Number },
    leadGuest: { type: Boolean, default: false },
    pan: { type: String },
  },
  { _id: false }
);

const RoomSchema = new Schema(
  {
    id: { type: String },
    name: { type: String },
    type: { type: String },
    bedType: { type: String },
    occupancy: { type: String },
    price: { type: Number },
    taxesAndFees: { type: Number },
    additionalCharges: { type: Number },
    quantity: { type: Number },
    mealPlanLabel: { type: String },
  },
  { _id: false }
);

const HotelBookingSchema = new Schema(
  {
    pnr: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User" }, // optional, for logged in users
    tboBookingId: { type: String }, // BookingRefNo / TBOReferenceNo
    tboConfirmationNo: { type: String }, // confirmation from supplier
    hotelId: { type: String, required: true },
    hotelName: { type: String, required: true },
    location: { type: String },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    status: { type: String, required: true, default: "Pending" }, // Pending, Confirmed, Cancelled
    contactInfo: {
      email: { type: String, required: true },
      mobile: { type: String, required: true },
    },
    guests: [GuestSchema],
    rooms: [RoomSchema],
    priceDetails: {
      total: { type: Number, required: true },
      taxes: { type: Number, required: true },
      additionalCharges: { type: Number, default: 0 },
    },
    traceId: { type: String },
    rawTboResponse: { type: Schema.Types.Mixed }, // Full booking response
    cancelledAt: { type: Date },                  // Set when TBO confirms cancellation
    cancelError: { type: String },                // Set when TBO cancel fails
    rawCancelResponse: { type: Schema.Types.Mixed }, // Full TBO cancel response
  },
  { timestamps: true }
);

export const HotelBooking = models.HotelBooking || model("HotelBooking", HotelBookingSchema);
