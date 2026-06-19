
export enum JourneyType {
  OneWay = 1,
  Return = 2,
  MultiStop = 3,
  AdvanceSearch = 4,
  SpecialReturn = 5,
}

export enum FlightCabinClass {
  All = 1,
  Economy = 2,
  PremiumEconomy = 3,
  Business = 4,
  PremiumBusiness = 5,
  First = 6,
}

export type TripDetailSegment = {
  Origin: string;
  Destination: string;
  FlightCabinClass: FlightCabinClass;
  PreferredDepartureTime: string;
  PreferredArrivalTime: string;
}

export type FlightSearchRequest ={
  EndUserIp: string;
  TokenId: string;
  AdultCount: number;
  ChildCount: number;
  InfantCount: number;
  DirectFlight?: boolean;
  OneStopFlight?: boolean;
  JourneyType: JourneyType;
  PreferredAirlines?: string[];
  Segments: TripDetailSegment[];
  Sources?: string[];
}

export type FlightFareRuleRequest = {
    EndUserIp: string;
    TokenId: string;
    TraceId: string;
    ResultIndex: string ;
}

export type AirlineInfo = {
  AirlineCode?: string[];
  AirlineName?: string[];
  FlightNumber: string;
  FareClass: string;
  OperatingCarrier: string;
};

export type FlightSegment = {
  TripIndicator: number;
  SegmentIndicator: number;
  Airline: AirlineInfo;
};

export type AirSearchResult = {
  ResultIndex: string;
  Source: string;
  IsLCC: boolean;
  IsRefundable: boolean;
  AirlineRemark: string;
  Segments: FlightSegment[];
};

export type FareQuoteRequest = {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  AdultCount: number;
  ChildCount: number;
  InfantCount: number;
  AirSearchResult: AirSearchResult[][];
};


export type CalendarFareSegment = {
  Origin: string;
  Destination: string;
  FlightCabinClass: FlightCabinClass;
  PreferredDepartureTime: string;
};


export type GetCalendarFareRequest = {
  EndUserIp: string;
  TokenId: string;
  JourneyType: JourneyType;
  PreferredAirlines?: string[];
  Segments: CalendarFareSegment[];
  Sources?: string[];
};



export type Fare = {
  BaseFare: number;
  Tax: number;
  TransactionFee: number;
  YQTax: number;
  AdditionalTxnFeeOfrd: number;
  AdditionalTxnFeePub: number;
  AirTransFee: number;
};

export type Meal = {
  Code?: string;
  Description?: string;
};

export type Seat = {
  Code?: string;
  Description?: string;
};

export type Passenger = {
  Title: string;
  FirstName: string;
  LastName: string;
  PaxType: string;
  DateOfBirth?: string;
  Gender: string;
  GSTCompanyAddress: string;
  GSTCompanyContactNumber: string;
  GSTCompanyName: string;
  GSTNumber: string;
  GSTCompanyEmail: string;
  PassportNo?: string;
  PassportExpiry?: string;
  PassportIssueDate?: string;
  AddressLine1: string;
  AddressLine2?: string;
  City: string;
  CountryCode: string;
  CountryName: string;
  ContactNo: string;
  Email: string;
  IsLeadPax: boolean;
  FFAirlineCode?: string;
  FFNumber?: string;
  Fare: Fare;
  Meal?: Meal;
  Seat?: Seat;
  Nationality: string;
};

export type BookRequest = {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  ResultIndex: string;
  Passengers: Passenger[];
};


export type PassengerPassport = {
  PaxId?: number;
  PassportNo?: string;
  PassportExpiry?: string;
  DateOfBirth: string;
};

export type TicketRequest = {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  PNR: string;
  BookingId: number;
  Passport?: PassengerPassport[];
  IsPriceChangeAccepted?: boolean;
};



export type GetBookingByBookingIdRequest =
  {   EndUserIp: string;
  TokenId: string;
    BookingId: number;
  };

/** Request 2 */
export type GetBookingByBookingIdAndPnrRequest = {
      EndUserIp: string;
  TokenId: string;
    BookingId: number;
    PNR: string;
  };

/** Request 3 */
export type GetBookingByPnrAndFirstNameRequest =
 {
      EndUserIp: string;
  TokenId: string;
    PNR: string;
    FirstName: string;
  };

/** Request 4 */
export type GetBookingByPnrAndLastNameRequest ={
      EndUserIp: string;
  TokenId: string;
    PNR: string;
    LastName: string;
  };

/** Request 5 */
export type GetBookingByPnrAndPassengerRequest ={
      EndUserIp: string;
  TokenId: string;
    PNR: string;
    FirstName: string;
    LastName: string;
  };

/** Request 6 */
export type GetBookingByTraceIdRequest ={
      EndUserIp: string;
  TokenId: string;
    TraceId: string;
  };




//------Interface
export interface FlightSearchResponse {
  TraceId: string;
  Origin: string;
  Destination: string;
  Results: FlightSearchResult[];
}
export interface FareTaxBreakdown {
  Currency: string;
  BaseFare: number;
  Tax: number;
  YQTax: number;
  AdditionalTxnFeeOfrd: number;
  AdditionalTxnFeePub: number;
  OtherCharges: number;

  ChargeBU: ChargeBreakup[];

  Discount: number;
  PublishedFare: number;
  CommissionEarned: number;
  PLBEarned: number;
  IncentiveEarned: number;
  OfferedFare: number;

  TdsOnCommission: number;
  TdsOnPLB: number;
  TdsOnIncentive: number;

  ServiceFee: number;
}

export interface ChargeBreakup {
  TBOMarkUp: number;
  ConvenienceCharge: number;
  OtherCharge: number;
}

export interface FareBreakdown {
  Currency: string;
  PassengerType: string;
  PassengerCount: number;
  BaseFare: number;
  Tax: number;
  YQTax: number;
  AdditionalTxnFeeOfrd: number;
  AdditionalTxnFeePub: number;
}

export interface FlightSegmentResponse {
  TripIndicator: number;
  SegmentIndicator: number;

  Airline: Airline;

  Origin: SegmentLocation;
  Destination: SegmentLocation;

  DepTime: string;
  ArrTime: string;

  AccumulatedDuration?: string;
  Duration?: string;
  GroundTime?: string;

  Mile?: string;

  StopOver?: boolean;
  StopPoint?: string;
  StopPointArrivalTime?: string;
  StopPointDepartureTime?: string;

  Craft?: string;

  IsETicketEligible: boolean;
  FlightStatus: string;
  Status: string;
}

export interface Airline {
  AirlineCode: string;
  AirlineName: string;
  FlightNumber: string;
  FareClass: string;
  OperatingCarrier: string;
}

export interface SegmentLocation {
  Airport: Airport;
}

export interface Airport {
  AirportCode: string;
  AirportName?: string;
  Terminal?: string;

  CityCode: string;
  CityName: string;

  CountryCode: string;
  CountryName: string;
}

export interface FareRule {
  Origin: string;
  Destination: string;
  Airline: string;
  FareBasisCode: string;
  FareRuleDetail: string[];
  FareRestriction: string;
  AirlineCode: string;
}

export interface Penalty {
  ReissueCharge?: number;
  CancellationCharge?: number;
}

export interface FlightSearchResult {
  ResultIndex: string;
  Source: string;
  IsLCC: boolean;
  IsRefundable: boolean;
  AirlineRemarks?: string;

  Fare: FareTaxBreakdown;
  FareBreakdown: FareBreakdown[];
  Segments: FlightSegmentResponse[][];

  LastTicketDate: string;
  TicketAdvisory?: string;

  FareRules?: FareRule[];
  Penalty?: Penalty;
}


/* ------------------------------------------------------------------ RAWSEARCH PARAMS*/

export interface RawSearchParams {
  AdultCount:        number;
  ChildCount:        number;
  InfantCount:       number;
  DirectFlight:      boolean;
  OneStopFlight:     boolean;
  JourneyType:       1 | 2 | 3;
  Segments:          TripDetailSegment[];
  PreferredAirlines: string[] | null;
  FareType?:         string;
}


export interface PriceRBDParams {
  traceId:      string;
  adultCount:   number;
  childCount:   number;
  infantCount:  number;
  airSearchResult: Array<{
    ResultIndex: string;
    Source:      number;
    IsLCC:       boolean;
    IsRefundable: boolean;
    AirlineRemark: string;
    Segments: Array<Array<{
      TripIndicator:    number;
      SegmentIndicator: number;
      Airline: {
        AirlineCode:      string;
        AirlineName:      string;
        FlightNumber:     string;
        FareClass:        string;
        OperatingCarrier: string;
      };
    }>>;
  }>;
}