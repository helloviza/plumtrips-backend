import { Router } from 'express';
const MOCK = [
    { id: 'h1', name: 'SeaView Residency', city: 'Goa', rating: 4.3, priceINR: 3499 },
    { id: 'h2', name: 'Downtown Suites', city: 'Mumbai', rating: 4.1, priceINR: 4299 },
    { id: 'h3', name: 'Indigo Palace', city: 'Delhi', rating: 4.5, priceINR: 3899 }
];
const router = Router();
// GET /api/v1/hotels/search?city=Goa
router.get('/search', (req, res) => {
    const city = String(req.query.city || '').toLowerCase();
    const data = MOCK.filter(h => !city || h.city.toLowerCase() === city);
    res.json({ results: data, count: data.length });
});
export default router;
