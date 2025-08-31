import { Router } from 'express';

export type Flight = {
  id: string;
  airlineCode: string;
  airlineName: string;
  flightNumber: string;
  from: string;
  to: string;
  departTime: string;
  arriveTime: string;
  durationMins: number;
  stops: number;
  priceINR: number;
  cabin: 'economy' | 'premium' | 'business' | 'first';
};

const MOCK: Flight[] = [
  { id:"1", airlineCode:"AI", airlineName:"Air India", flightNumber:"AI 665", from:"DEL", to:"BOM", departTime:"06:15", arriveTime:"08:25", durationMins:130, stops:0, priceINR:5599, cabin:"economy" },
  { id:"2", airlineCode:"6E", airlineName:"IndiGo",    flightNumber:"6E 211", from:"DEL", to:"BOM", departTime:"07:40", arriveTime:"09:55", durationMins:135, stops:0, priceINR:4899, cabin:"economy" },
  { id:"3", airlineCode:"UK", airlineName:"Vistara",   flightNumber:"UK 955", from:"DEL", to:"BOM", departTime:"09:30", arriveTime:"11:45", durationMins:135, stops:0, priceINR:6299, cabin:"economy" },
  { id:"4", airlineCode:"6E", airlineName:"IndiGo",    flightNumber:"6E 403", from:"DEL", to:"BOM", departTime:"13:05", arriveTime:"15:45", durationMins:160, stops:1, priceINR:4499, cabin:"economy" }
];

const router = Router();

// GET /api/v1/flights/search?from=DEL&to=BOM&cabin=economy
router.get('/search', (req, res) => {
  const from = String(req.query.from || '').toUpperCase();
  const to = String(req.query.to || '').toUpperCase();
  const cabin = (String(req.query.cabin || 'economy').toLowerCase()) as Flight['cabin'];

  const data = MOCK.filter(f =>
    (!from || f.from === from) &&
    (!to || f.to === to) &&
    (!cabin || f.cabin === cabin)
  );

  res.json({ results: data, count: data.length });
});

export default router;
