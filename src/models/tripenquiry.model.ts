import mongoose, { Document, Model, Schema } from "mongoose";

export enum BudgetRange {
    UNDER_1L = "under-1L",
    ONE_TO_TWO_L = "1L-2L",
    TWO_TO_FIVE_L = "2L-5L",
    FIVE_L_PLUS = "5L-plus",
}

export enum TravelMonth {
    JANUARY = "January",
    FEBRUARY = "February",
    MARCH = "March",
    APRIL = "April",
    MAY = "May",
    JUNE = "June",
    JULY = "July",
    AUGUST = "August",
    SEPTEMBER = "September",
    OCTOBER = "October",
    NOVEMBER = "November",
    DECEMBER = "December",
}

export interface TripInquiryDocument extends Document {
    destination: string;
    departureCity: string;
    budget: BudgetRange;
    month: TravelMonth;
    travelers: number;
    createdAt: Date;
    updatedAt: Date;
}

const TripInquirySchema: Schema<TripInquiryDocument> = new Schema(
    {
        destination: { type: String, required: true, trim: true },
        departureCity: { type: String, required: true, trim: true },
        budget: {
            type: String,
            enum: Object.values(BudgetRange),
            required: true,
        },
        month: {
            type: String,
            enum: Object.values(TravelMonth),
            required: true,
        },
        travelers: {
            type: Number,
            required: true,
            min: 1,
            max: 20,
        },
    },
    {
        timestamps: true,
    }
);

export const TripInquiryModel: Model<TripInquiryDocument> =
    mongoose.models.TripInquiry ||
    mongoose.model<TripInquiryDocument>("TripInquiry", TripInquirySchema);

export type CreateTripInquiryPayload = {
    destination: string;
    departureCity: string;
    budget: BudgetRange;
    month: TravelMonth;
    travelers: number;
};

export type UpdateTripInquiryPayload = Partial<CreateTripInquiryPayload> & {
    id: string;
};

export type TripInquiryListResponse = {
    data: TripInquiryDocument[];
    total: number;
};

export type TripInquirySingleResponse = {
    data: TripInquiryDocument;
};