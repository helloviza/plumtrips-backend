import mongoose, {Document, Model, Schema} from "mongoose";

export enum FrontpageScope {
    VISAS = "VISAS",
    HOLIDAYS = "HOLIDAYS",
    STOPOVER= "STOPOVER",
    OFFERS = "OFFERS",
    CRUISES = "CRUISES",
    BLOGS = "BLOGS",
    FLIGHTS = "FLIGHTS",
    HOTELS = "HOTELS"
}

export interface FrontpageDocument extends Document {
    scope: FrontpageScope;
    title: string;
    subtitle: string;
    tag_one: string;
    tag_two: string;
    extra_info: string;
    image: string;
    href: string;
    trending: boolean;
    active: boolean;
    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const FrontpageSchema: Schema<FrontpageDocument> = new Schema(
    {
        scope: {
            type: String,
            enum: Object.values(FrontpageScope),
            reuired: true,
        },
        title: {type: String, required: true},
        subtitle: {type: String, required: true},
        tag_one: {type: String, required: true},
        tag_two: {type: String, required: true},
        trending: {type: Boolean, default: false},
        active: {type: Boolean, default: true},
        extra_info: {type: String},
        image: {type: String, required: true},
        href: {type: String, required: true},
        createdBy: {    
            type: Schema.Types.ObjectId,
            ref: "MarketingAdmin",
            required: false,
        },
    },
    {
        timestamps: true,       
        }   
    
)

export const FrontpageModel: Model<FrontpageDocument> =
    mongoose.models.Frontpage ||
    mongoose.model<FrontpageDocument>("Frontpage", FrontpageSchema);

export type CreateFrontpagePayload = {
    scope: FrontpageScope;
    title: string;
    subtitle: string;
    tag_one: string;
    tag_two: string;
    extra_info: string;
    trending: boolean;
    active: boolean;
    image: string;
    href: string;
};

export type UpdateFrontpagePayload = Partial<CreateFrontpagePayload> & {
    id: string;
};

export type FrontpageListResponse = {
    data: FrontpageDocument[];
    total: number;
}

export type FrontpageSingleResponse = {
    data: FrontpageDocument;
}