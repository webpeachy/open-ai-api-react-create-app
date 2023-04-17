import { Configuration, OpenAIApi } from "openai";
import { exec } from 'child_process';
import { promisify } from 'util';
import AWS from 'aws-sdk';
import fs from 'fs/promises';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import path from 'path';
import dotenv from 'dotenv';
import open from 'open';
import fetch  from "node-fetch";
dotenv.config();


const configuration = new Configuration({
    apiKey: process.env.OPEN_AI_API_KEY,
});

let awsCredentials;
const awsConfig = { region: 'us-east-1' }
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    awsCredentials = new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });

    awsConfig.credentials = awsCredentials
}
AWS.config.update(awsConfig);

const s3 = new AWS.S3();
const openai = new OpenAIApi(configuration);


const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

const callAPI = async () => {
    const appDescription = await fs.readFile('app-description.txt', 'utf-8');
    logMessage(`Generating code for "${appDescription}"...`);
   // console.log(chalk.yellow());
    progressBar.start(100, 0);

    const reactSpecs = [
        'component name should be App like this: const App = () => {',
        'should be set with export default App',
        'only return code for component and the first react import. no need the react-dom import',
        'the react code should have import React, { useState, useEffect } from "react" and use the react hook setState',
    ]

    const promtText = `${appDescription}.${reactSpecs.join('. ')}`

    const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: promtText,
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
    });

    progressBar.update(20);

    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    const responseFilePath = path.join(currentDir, 'response.json');
    await fs.writeFile(responseFilePath, JSON.stringify(response.data.choices[0], null, 2));
    progressBar.update(30);
    logMessage(`Response written to: ${responseFilePath}`);
    const text = response.data.choices[0].text;

    // TODO: get cypress code to test component
    //const { reactCode, cypressCode } = await extractAndWriteCodeToFile(text)
  
     const reactCode = await getReactCode(text)

    progressBar.update(40);

    const reactAppPath = './react-app';

    await createReactApp();
    progressBar.update(50);
    await copyReactCodeToReactApp(reactAppPath, reactCode);
    progressBar.update(60);
    await installDependenciesAndBuildReactApp(reactAppPath);
    //TODO: set the app to be tested locally before depling to cloud.
    //await runReactAppAndCypressTests();

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

    logMessage(`React app deployed successfully to S3 bucket: ${bucketName}`)
    const bucketHtmlUrl = `https://${bucketName}.s3.amazonaws.com/index.html`
    console.log(chalk.green(`View the app at:  ${bucketHtmlUrl} | `));

    await open(bucketHtmlUrl, { app: 'google chrome' });
    await copySrcToHistoryFolder();
};

const getReactCode = async (text) => {
    text =replaceTextBeforeImport(text)
   
    logMessage('Full code:', text);
   
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const srcDir = path.join(currentDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const reactFilePath = path.join(srcDir, 'react-app.js');
   
    await writeCodeToFile(reactFilePath, text);
  
    logMessage('React app code written to:', reactFilePath);
    logMessage('React code:', text);    
    const reactCode = text
    return  reactCode
};

function replaceTextBeforeImport(text) {
    const importIndex = text.indexOf("import");
    if (importIndex !== -1) {
      text = text.slice(importIndex);
    }
    return text;
  }

const extractAndWriteCodeToFile = async (text) => {
    logMessage('Full code:', text);
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
    logMessage('React app code written to:', reactFilePath);
    logMessage('React code:', reactCode);

    progressBar.update(37);
    logMessage('Cypress test code written to:', cypressFilePath);
    logMessage('Cypress code:', cypressCode);
    return { reactCode, cypressCode}
};

const writeCodeToFile = async (filePath, code) => {
    await fs.writeFile(filePath, code);
};

const createReactApp = async () => {
    const reactAppDir = path.join(process.cwd(), 'react-app');
  
    try {
      // check if react app directory already exists
      logMessage(`Checking if React app directory exists at ${reactAppDir}...`);
      await fs.access(reactAppDir, 0);
      progressBar.update(45);
      logMessage(`React app directory already exists at ${reactAppDir}. Skipping creation.`);
      return;
    } catch (err) {
      // directory does not exist, create react app
      progressBar.update(45);
      logMessage(`fs.access(${reactAppDir}, fs.constants.F_OK) returned an error: ${err}`);
      const command = 'npx create-react-app react-app && cd react-app && npm add cypress && cp ../cypress.config.js ./ && cp -r ../cypress-folder ./';
      await promisify(exec)(command);
      progressBar.update(47);
      logMessage(`React app created at ${reactAppDir}.`);
    }
  };


const copyReactCodeToReactApp = async (reactAppPath, reactCode) => {
    const appFilePath = path.join(reactAppPath, 'src', 'App.js');
    await writeCodeToFile(appFilePath, reactCode);
    progressBar.update(55);
    logMessage(`React app code written to: ${appFilePath}`);
};

const installDependenciesAndBuildReactApp = async (reactAppPath) => {
    const command = `cd ${reactAppPath} && npm install && npm run build `;
    await promisify(exec)(command);
    progressBar.update(65);
    logMessage(`React app built at ${path.join(reactAppPath, 'build')}`);
};

const createRandomBucketName = async () => {
    const randomString = Math.random().toString(36).substring(2, 15);
    return `open-ai-api-test-${randomString}`;
};

const createBucket = async (bucketName) => {
    const createBucketParams = { Bucket: bucketName };
    await s3.createBucket(createBucketParams).promise();
    logMessage(`S3 bucket created: ${bucketName}`);
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
    logMessage(`Bucket policy set for ${bucketName}`);
};

const uploadBuildDirectoryToBucket = async (bucketName, buildPath) => {
    const s3UploadCommand = `aws s3 cp ${buildPath} s3://${bucketName} --recursive --metadata-directive REPLACE --cache-control max-age=31536000,public --exclude "service-worker.js" --exclude "robots.txt" --include "*.html" --include "*.css" --acl public-read --content-encoding identity --storage-class REDUCED_REDUNDANCY`;
    await promisify(exec)(s3UploadCommand);
};

const copySrcToHistoryFolder = async () => {
    const currentDir = process.cwd();
    const srcDir = path.join(currentDir, 'src');
    const historyDir = path.join(currentDir, 'history', new Date().toISOString().replace(/T/, '-').replace(/\..+/, '').replace(/:/g, "-"));
  
    await fs.mkdir(historyDir, { recursive: true });
  
    const command = `cp -r ${srcDir} ${historyDir}`;
    await promisify(exec)(command);
  
    logMessage(`Copied src folder to ${historyDir}`);
  };

const appDescription = process.argv[2] || 'App to manage a todo list';
callAPI(appDescription);


let logFilePath;

const logMessage = async (message) => {
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const logDir = path.join(currentDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    if (!logFilePath) {
        logFilePath = path.join(logDir, `log_${new Date().toISOString().replace(/:/g, '-')}.txt`);
    }
    const logMessage = `${new Date().toISOString()} - ${message}\n`;
    await fs.appendFile(logFilePath, logMessage);
};

const runReactAppAndCypressTests = async () => {
  const reactAppPath = 'react-app';

  // Start React app
  const startAppProcess = exec('npm run start', { cwd: reactAppPath });
  startAppProcess.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });
  startAppProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  // Wait until app is available on localhost:3000
  let appIsAvailable = false;
  while (!appIsAvailable) {
    try {
      const response = await fetch('http://localhost:3000');
      if (response.ok) {
        appIsAvailable = true;
        //console.log('React app is available on http://localhost:3000');
        logMessage('React app is available for test on http://localhost:3000')
      }
    } catch (error) {
        //console.log(error)
      // App not available yet, wait for a bit and try again
      await new Promise(resolve => setTimeout(resolve, 1000));
      logMessage('waiting for app to be ready on http://localhost:3000');
    }
  }

  // Run Cypress tests
  const runTestsProcess = exec('npx cypress run --spec cypress/e2e/app-health.cy.js', { cwd: reactAppPath });
  runTestsProcess.stdout.on('data', (data) => {
    logMessage(`stdout: ${data}`);
  });
  runTestsProcess.stderr.on('data', (data) => {
    logMessage(`stderr: ${data}`);
  });
};
