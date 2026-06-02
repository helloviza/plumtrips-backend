import mongoose, { Document, Model, Schema } from "mongoose";

export interface CountryEnquiryDocument extends Document {
    name: string;
    email: string;
    teamSize: number;
    date: string;
    note?: string;
    createdAt: Date;
    updatedAt: Date;
}

const CountryEnquirySchema: Schema<CountryEnquiryDocument> = new Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, lowercase: true },
        teamSize: { type: Number, required: true, min: 10 },
        date: { type: String, required: true },
        note: { type: String, trim: true },
    },
    {
        timestamps: true,
    }
);

export const CountryEnquiryModel: Model<CountryEnquiryDocument> =
    mongoose.models.CountryEnquiry ||
    mongoose.model<CountryEnquiryDocument>("CountryEnquiry", CountryEnquirySchema);

export type CreateCountryEnquiryPayload = {
    name: string;
    email: string;
    teamSize: number;
    date: string;
    note?: string;
};

export type UpdateCountryEnquiryPayload = Partial<CreateCountryEnquiryPayload> & {
    id: string;
};

export type CountryEnquiryListResponse = {
    data: CountryEnquiryDocument[];
    total: number;
};

export type CountryEnquirySingleResponse = {
    data: CountryEnquiryDocument;
};