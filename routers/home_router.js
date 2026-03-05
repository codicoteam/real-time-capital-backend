const express = require("express");
const router = express.Router();
const homeController = require("../controllers/home_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Home
 *   description: Customer home page
 */

/**
 * @swagger
 * /api/v1/home:
 *   get:
 *     summary: Get customer home data (profile, active auctions, latest bid, recent loan applications)
 *     tags: [Home]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Home data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     profile:
 *                       type: object
 *                     active_auctions:
 *                       type: array
 *                     latest_bid:
 *                       type: object
 *                       nullable: true
 *                     latest_loan_applications:
 *                       type: array
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request / error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden – not a customer
 */
router.get(
  "/",
  authMiddleware,
  requireRoles("customer"), // only customers can access
  homeController.getHomeData,
);

module.exports = router;
