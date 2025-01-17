// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute
// it and / or  modify it under the terms of the GNU Affero General Public License, version 3,
// as published by the Free Software Foundation.This program is distributed in the hope that it
// will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
// or FITNESS FOR A PARTICULAR PURPOSE.See the GNU Affero General Public License for more details.
// You should have received a copy of the GNU Affero General Public License along with this program.
// If not, see < http://www.gnu.org/licenses/>.

import fs from "fs";
import AWS from "aws-sdk";
import nodemailer from "nodemailer";
import mg from "nodemailer-mailgun-transport";
import Config from "../config";

// https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-region.html
// v2 docs, since we use v2 in our package.json: "aws:sdk": "2.78.0"
AWS.config.update({ region: Config.awsRegion });

function sendTextEmailWithBackup(
  sender: any,
  recipient: any,
  subject: any,
  text: any
) {
  const transportTypes = Config.emailTransportTypes
    ? Config.emailTransportTypes.split(",")
    : ["aws-ses", "mailgun"];
  if (transportTypes.length < 2) {
    new Error("No backup email transport available.");
  }
  const backupTransport = transportTypes[1];
  sendTextEmail(sender, recipient, subject, text, backupTransport);
}

function isDocker() {
  // See: https://stackoverflow.com/a/25518345/504018
  return fs.existsSync("/.dockerenv");
}

function getMailOptions(transportType: any) {
  let mailgunAuth;

  switch (transportType) {
    case "maildev":
      return {
        // Allows running outside docker, connecting to exposed port of maildev container.
        host: isDocker() ? "maildev" : "localhost",
        port: 25,
        ignoreTLS: true,
      };
    case "mailgun":
      mailgunAuth = {
        auth: {
          // This forces fake credentials if envvars unset, so error is caught
          // in auth and failover works without crashing server process.
          // TODO: Suppress error thrown by mailgun library when unset.
          api_key: Config.mailgunApiKey || "unset-value",
          domain: Config.mailgunDomain || "unset-value",
        },
      };
      return mg(mailgunAuth);
    case "aws-ses":
      return {
        // reads AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from process.env
        // reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from process.env
        SES: new AWS.SES({ apiVersion: "2010-12-01" }),
      };
    default:
      return {};
  }
}

function sendTextEmail(
  sender: any,
  recipient: any,
  subject: any,
  text: any,
  transportTypes = Config.emailTransportTypes,
  priority = 1
) {
  // Exit if empty string passed.
  if (!transportTypes) {
    return;
  }

  const transportTypesArray = transportTypes.split(",");
  // Shift first index and clone to rename.
  const thisTransportType = transportTypesArray.shift();
  const nextTransportTypes = [...transportTypesArray];
  const mailOptions = getMailOptions(thisTransportType);
  const transporter = nodemailer.createTransport(mailOptions);

  let promise: any = transporter
    .sendMail({ from: sender, to: recipient, subject: subject, text: text })
    .catch(function (err: any) {
      console.error(
        "polis_err_email_sender_failed_transport_priority_" +
          priority.toString()
      );
      console.error(
        `Unable to send email via priority ${priority.toString()} transport '${thisTransportType}' to: ${recipient}`
      );
      console.error(err);
      return sendTextEmail(
        sender,
        recipient,
        subject,
        text,
        nextTransportTypes.join(","),
        priority + 1
      );
    });
  return promise;
}

export {
  sendTextEmail,
  sendTextEmailWithBackup as sendTextEmailWithBackupOnly,
};

export default {
  sendTextEmail: sendTextEmail,
  sendTextEmailWithBackupOnly: sendTextEmailWithBackup,
};
