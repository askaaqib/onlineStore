import express from 'express';
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import bodyParser from "body-parser";
import FacebookTokenStragegy from "passport-facebook-token";
import passport from "passport";
import User from "../models/User";
import config from "../config";
import VerifyToken from "../_helper/VerifyToken";
import randomString from "randomstring";
import mailer from "../_helper/mailer";

const router = express.Router();
router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

// TODO: Refactor to controller and service like the other 2

//Passport strategy for facebook login
passport.use(
  "facebookToken",
  new FacebookTokenStragegy(
    {
      clientID: config.clientID,
      clientSecret: config.clientSecret,
    },
    function (accessToken, refreshToken, profile, done) {
      var user = { name: profile._json.name, email: profile._json.email };
      return done(null, user);
    }
  )
);

passport.serializeUser(function (user, cb) {
  cb(null, user);
});

passport.deserializeUser(function (obj, cb) {
  cb(null, obj);
});

router.use(passport.initialize());
router.use(passport.session());

//Fb login or create user
router.post(
  "/facebook/login",
  passport.authenticate("facebookToken"),
  function (req, res) {
    User.findOne({ email: req.user.email }, function (err, user) {
      //if(err) return res.status(404).send("Problem in getting user info from Facebook")
      if (user) {
        var token = jwt.sign({ id: user._id }, config.secret, {
          expiresIn: 86400, // expires in 24 hours
        });
        return res.send({
          auth: true,
          token: token,
          userId: user._id,
          name: user.name,
        });
      } else {
        User.create(req.user, function (err, user) {
          if (err)
            return res
              .status(500)
              .json({ message: "Problem in creating new user" });
          if (user) {
            var token = jwt.sign({ id: user._id }, config.secret, {
              expiresIn: 86400, // expires in 24 hours
            });
            return res.status(201).send({
              auth: true,
              token: token,
              userId: user._id,
              name: user.name,
            });
          }
        });
      }
    });
    //res.send(req.user ? 200 : 401);
  }
);

//New user registration
router.post("/register", async (req, res) => {
  try {
    let user = await User.findOne({ email: req.body.email });
    if (user) {
      return res
        .status(409)
        .json({ message: "This e-mail is already registered" });
    }
    let hashedPassword = bcrypt.hashSync(req.body.password, 8);
    const secretToken = randomString.generate();
    let newUser = await User.create({
      name: req.body.name,
      email: req.body.email,
      password: hashedPassword,
      //For email verification
      secretToken: secretToken,
      isActivated: false,
    });
    if (newUser) {
      console.log(newUser);
      const mailOptions = {
        from: "support@mirrorwall.org", //sender address
        to: newUser.email, //list of receivers
        subject: "Please verify the email address", // Subject line
        html: `<h4>Thank you for registering.<h4>
        <p>Please verify this email address by clicking the following link</p>
        <a href="https://frozen-lake-54898.herokuapp.com/api/auth/verify/${newUser.secretToken}">
        https://frozen-lake-54898.herokuapp.com/api/auth/verify/${newUser.secretToken}</a>`,
      };
      let mailResponse = await mailer.sendMail(mailOptions);
      if (mailResponse.messageId) {
        res.status(200).send(newUser.email);
      } else {
        let deleted = await User.deleteOne({ email: req.body.email });
        console.log(deleted);
        throw new Error("Something wrong");
      }
    }
  } catch (err) {
    console.log(err);
    let deleted = await User.deleteOne({ email: req.body.email });
    return res.status(500).json({ message: "Error. User Not registered" });
  }
});

//Login registered users;
router.post("/login", function (req, res) {
  //console.log(config.clientID, config.clientSecret)
  User.findOne({ email: req.body.email }, function (err, user) {
    if (err) return res.status(500).send("Error on the server.");
    if (!user) return res.status(404).send("No user found.");
    if (!user.isActivated) {
      //console.log("activation", user, user.isActivated);
      return res.status(401).send("Please verify the email address first");
    }

    var passwordIsValid = bcrypt.compareSync(req.body.password, user.password);
    if (!passwordIsValid) {
      //console.log("password", req.body.password, passwordIsValid);
      return res.status(401).send({ auth: false, token: null });
    }
    var token = jwt.sign({ id: user._id }, config.secret, {
      expiresIn: 86400, // expires in 24 hours
    });
    res
      .status(200)
      .send({ auth: true, token: token, userId: user._id, name: user.name });
  });
});

//Email verification of registered users
router.get("/verify/:secretToken", function (req, res) {
  User.findOne({ secretToken: req.params.secretToken }, function (err, user) {
    if (err) return res.status(500).send("Error on the server.");
    if (!user) return res.status(404).send("No user found.");

    user.isActivated = true;
    user.secretToken = "";

    user.save(function (err, user) {
      if (err) return res.status(500).send("Error verifying the account");
      res.redirect("https://frozen-lake-54898.herokuapp.com/#/login/");
    });
  });
});

//Get info of the current user
router.get("/me", VerifyToken, function (req, res, next) {
  User.findById(req.userId, { password: 0 }, function (err, user) {
    if (err)
      return res.status(500).send("There was a problem finding the user.");
    if (!user) return res.status(404).send("No user found.");

    res.status(200).send(user);
  });
});

export default router;
