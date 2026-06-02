import express from "express";
import holidaysRouter from "./holidays.js";
import cruisesRouter from "./cruises.js";
import offersRouter from "./offers.js";
import blogsRouter from "./blogs_routes.js";
import frontpage from "./frontpage.js"
import request from "./request.routes.js"
import tripenquiry from "./tripenquiry.js"
import countryenquiry from "./countryEnquiry.routes.js"

const router = express.Router();

// Mount sub-routers
router.use("/holidays", holidaysRouter);
router.use("/cruises", cruisesRouter);
router.use("/offers", offersRouter);
router.use("/blogs", blogsRouter);
router.use("/frontpage", frontpage);
router.use("/requests",request);
router.use("/tripenquiry",tripenquiry);
router.use("/countryenuiry",countryenquiry)

export default router;