import express from "express";
import holidaysRouter from "./holidays.js";
import cruisesRouter from "./cruises.js";
import offersRouter from "./offers.js";
import blogsRouter from "./blogs_routes.js";

const router = express.Router();

// Mount sub-routers
router.use("/holidays", holidaysRouter);
router.use("/cruises", cruisesRouter);
router.use("/offers", offersRouter);
router.use("/blogs", blogsRouter);

export default router;