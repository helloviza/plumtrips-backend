import { Request, Response } from "express";
import { cheapHttp } from "./authCheap.js";

export const getCheapFlights = async (
  req: Request,
  res: Response
) => {
  try {
    const { data } = await cheapHttp.post(
      process.env.TBO_FLIGHTS_CHEAP!,
      {}
    );

    res.json(data);
  } catch (err: any) {
    console.log(err.response?.status);
    console.log(err.response?.data);

    res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
};

export const getCheapHotels = async (
  req: Request,
  res: Response
) => {
  try {
    const { data } = await cheapHttp.post(
      process.env.TBO_HOTELS_CHEAP!,
      {}
    );

    res.json(data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
};