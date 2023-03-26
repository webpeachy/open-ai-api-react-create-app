import { Configuration, OpenAIApi } from "openai";
import { exec } from 'child_process';
import { promisify } from 'util';
import AWS from 'aws-sdk';
import fs from 'fs/promises';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();


const configuration = new Configuration({
    apiKey: process.env.API_KEY,
});
AWS.config.update({ region: 'us-east-1' });

const s3 = new AWS.S3();
const openai = new OpenAIApi(configuration);


const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

const callAPI = async () => {
    const appDescription = await fs.readFile('app-description.txt', 'utf-8');
    console.log(chalk.yellow(`Generating code for "${appDescription}"...`));
    progressBar.start(100, 0);

    const reactSpecs = [
        'component name should be App',
        'should be set with export default App',
        'only return code for component and the first react import. no need the react-dom import',
        'the react code should have import React, { useState } from "react" and use the react hook setState',
        'also add a cypress test for the react componen we created',
        'add // REACT-CODE before react code and // CYPRESS-CODE before cypress code'
    ]
    const promtText = `${appDescription}.${reactSpecs.join('. ')}`
    const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: promtText,
        temperature: 0.7,
        max_tokens: 512,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
    });

    progressBar.update(20);

    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    const responseFilePath = path.join(currentDir, 'response.json');
    await fs.writeFile(responseFilePath, JSON.stringify(response.data.choices[0], null, 2));
    progressBar.update(30);
    console.log(chalk.green(`Response written to: ${responseFilePath}`));

    const text = response.data.choices[0].text;

    const { reactCode, cypressCode } = await extractAndWriteCodeToFile(text)

    progressBar.update(40);

    const reactAppPath = './react-app';

    await createReactApp();
    progressBar.update(50);
    await copyReactCodeToReactApp(reactAppPath, reactCode);
    progressBar.update(60);
    await installDependenciesAndBuildReactApp(reactAppPath);

    progressBar.update(70);

    const buildPath = path.join(reactAppPath, 'build');
    const bucketName = await createRandomBucketName();
    progressBar.update(80);
    await createBucket(bucketName);
    progressBar.update(85);
    await setBucketPolicy(bucketName);
    progressBar.update(90);
    await uploadBuildDirectoryToBucket(bucketName, buildPath);

    progressBar.update(100);
    progressBar.stop();

    console.log(chalk.green(`React app deployed successfully to S3 bucket: ${bucketName}`));
    console.log(chalk.green(`View the app at: https://${bucketName}.s3.amazonaws.com/index.html  | `));
};

const extractAndWriteCodeToFile = async (text) => {
    const reactCodeRegex = /\/\/ REACT-CODE([\s\S]+?)\/\/ CYPRESS-CODE/g;
    const reactCodeMatch = reactCodeRegex.exec(text);
    const reactCode = reactCodeMatch ? reactCodeMatch[1].trim() : '';

    const cypressCodeRegex = /\/\/ CYPRESS-CODE([\s\S]+)/g;
    const cypressCodeMatch = cypressCodeRegex.exec(text);
    const cypressCode = cypressCodeMatch ? cypressCodeMatch[1].trim() : '';
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const srcDir = path.join(currentDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const reactFilePath = path.join(srcDir, 'react-app.js');
    const cypressFilePath = path.join(srcDir, 'cypress-test.js');

    await writeCodeToFile(reactFilePath, reactCode);
    await writeCodeToFile(cypressFilePath, cypressCode);
    progressBar.update(35);
    console.log(' | React app code written to:', reactFilePath);
    progressBar.update(37);
    console.log(' | Cypress test code written to:', cypressFilePath);
    return { reactCode, cypressCode}
};

const writeCodeToFile = async (filePath, code) => {
    await fs.writeFile(filePath, code);
};

const createReactApp = async () => {
    const reactAppDir = path.join(process.cwd(), 'react-app');
  
    try {
      // check if react app directory already exists
      console.log(`| Checking if React app directory exists at ${reactAppDir}...`);
      await fs.access(reactAppDir, 0);
      progressBar.update(45);
      console.log(` | React app directory already exists at ${reactAppDir}. Skipping creation.`);
      return;
    } catch (err) {
      // directory does not exist, create react app
      progressBar.update(45);
      console.log(`fs.access(${reactAppDir}, fs.constants.F_OK) returned an error: ${err}`);
      const command = 'npx create-react-app react-app';
      await promisify(exec)(command);
      progressBar.update(47);
      console.log(` | React app created at ${reactAppDir}.`);
    }
  };


const copyReactCodeToReactApp = async (reactAppPath, reactCode) => {
    const appFilePath = path.join(reactAppPath, 'src', 'App.js');
    await writeCodeToFile(appFilePath, reactCode);
    progressBar.update(55);
    console.log(` | React app code written to: ${appFilePath}`);
};

const installDependenciesAndBuildReactApp = async (reactAppPath) => {
    const command = `cd ${reactAppPath} && npm install && npm run build`;
    await promisify(exec)(command);
    progressBar.update(65);
    console.log(` | React app built at ${path.join(reactAppPath, 'build')}`);
};

const createRandomBucketName = async () => {
    const randomString = Math.random().toString(36).substring(2, 15);
    return `open-ai-api-test-${randomString}`;
};

const createBucket = async (bucketName) => {
    const createBucketParams = { Bucket: bucketName };
    await s3.createBucket(createBucketParams).promise();
    console.log(` | S3 bucket created: ${bucketName}`);
};

const setBucketPolicy = async (bucketName) => {
    const publicReadPolicy = {
        Version: '2012-10-17',
        Statement: [{
            Sid: 'PublicReadGetObject',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`]
        }]
    };

    const setBucketPolicyParams = { Bucket: bucketName, Policy: JSON.stringify(publicReadPolicy) };
    await s3.putBucketPolicy(setBucketPolicyParams).promise();
    console.log(` | Bucket policy set for ${bucketName}`);
};

const uploadBuildDirectoryToBucket = async (bucketName, buildPath) => {
    const s3UploadCommand = `aws s3 cp ${buildPath} s3://${bucketName} --recursive --metadata-directive REPLACE --cache-control max-age=31536000,public --exclude "*.map" --exclude "service-worker.js" --exclude "robots.txt" --include "*.html" --include "*.css" --acl public-read --content-encoding identity --storage-class REDUCED_REDUNDANCY`;
    await promisify(exec)(s3UploadCommand);
};

const appDescription = process.argv[2] || 'App to manage a todo list';
callAPI(appDescription);