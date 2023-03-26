const { Configuration, OpenAIApi } = require("openai");
const { exec } = require('child_process');
const { promisify } = require('util');
const AWS = require('aws-sdk');
const fs = require('fs').promises;
// const fsFull = require('fs').promises;
const path = require('path');
require('dotenv').config();

const configuration = new Configuration({
    apiKey: process.env.API_KEY,
});
AWS.config.update({ region: 'us-east-1' });

const s3 = new AWS.S3();
const openai = new OpenAIApi(configuration);

const callAPI = async (appDescription) => {
    const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: `${appDescription}. component name should be App, and should be set with export default App. only return code for component and the first react import. no need the react-dom import. also add a cypress test for the react componen we created.  add // REACT-CODE before react code and // CYPRESS-CODE before cypress code`,
        temperature: 0.7,
        max_tokens: 512,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
    });

    const responseFilePath = path.join(__dirname, 'response.json');
    await fs.writeFile(responseFilePath, JSON.stringify(response.data.choices[0], null, 2));
    console.log('Response written to:', responseFilePath);

    const text = response.data.choices[0].text;

     const { reactCode, cypressCode} = await extractAndWriteCodeToFile  (text)

    const reactAppPath = './react-app';
    // await deleteFolderRecursive(reactAppPath);

    await createReactApp();
    await copyReactCodeToReactApp(reactAppPath, reactCode);
    await installDependenciesAndBuildReactApp(reactAppPath);

    const buildPath = path.join(reactAppPath, 'build');
    const bucketName = await createRandomBucketName();

    await createBucket(bucketName);
    await setBucketPolicy(bucketName);
    await uploadBuildDirectoryToBucket(bucketName, buildPath);

    console.log(`React app deployed successfully to S3 bucket: ${bucketName}`);
    console.log(`View the app at: https://${bucketName}.s3.amazonaws.com/index.html`);
};

const extractAndWriteCodeToFile = async (text) => {
    const reactCodeRegex = /\/\/ REACT-CODE([\s\S]+?)\/\/ CYPRESS-CODE/g;
    const reactCodeMatch = reactCodeRegex.exec(text);
    const reactCode = reactCodeMatch ? reactCodeMatch[1].trim() : '';

    const cypressCodeRegex = /\/\/ CYPRESS-CODE([\s\S]+)/g;
    const cypressCodeMatch = cypressCodeRegex.exec(text);
    const cypressCode = cypressCodeMatch ? cypressCodeMatch[1].trim() : '';

    const srcDir = path.join(__dirname, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const reactFilePath = path.join(srcDir, 'react-app.js');
    const cypressFilePath = path.join(srcDir, 'cypress-test.js');

    await writeCodeToFile(reactFilePath, reactCode);
    await writeCodeToFile(cypressFilePath, cypressCode);

    console.log('React app code written to:', reactFilePath);
    console.log('Cypress test code written to:', cypressFilePath);
    return { reactCode, cypressCode}
};

const writeCodeToFile = async (filePath, code) => {
    await fs.writeFile(filePath, code);
};

const createReactApp = async () => {
    const reactAppDir = path.join(process.cwd(), 'react-app');
  
    try {
      // check if react app directory already exists
      console.log(`Checking if React app directory exists at ${reactAppDir}...`);
      await fs.access(reactAppDir, 0);
      console.log(`fs.access(${reactAppDir}, fs.constants.F_OK) returned true.`);
      console.log(`React app directory already exists at ${reactAppDir}. Skipping creation.`);
      return;
    } catch (err) {
      // directory does not exist, create react app
      console.log(`fs.access(${reactAppDir}, fs.constants.F_OK) returned an error: ${err}`);
      const command = 'npx create-react-app react-app';
      await promisify(exec)(command);
      console.log(`React app created at ${reactAppDir}.`);
    }
  };


const copyReactCodeToReactApp = async (reactAppPath, reactCode) => {
    const appFilePath = path.join(reactAppPath, 'src', 'App.js');
    await writeCodeToFile(appFilePath, reactCode);
    console.log(`React app code written to: ${appFilePath}`);
};

const installDependenciesAndBuildReactApp = async (reactAppPath) => {
    const command = `cd ${reactAppPath} && npm install && npm run build`;
    await promisify(exec)(command);
    console.log(`React app built at ${path.join(reactAppPath, 'build')}`);
};

const createRandomBucketName = async () => {
    const randomString = Math.random().toString(36).substring(2, 15);
    return `open-ai-api-test-${randomString}`;
};

const createBucket = async (bucketName) => {
    const createBucketParams = { Bucket: bucketName };
    await s3.createBucket(createBucketParams).promise();
    console.log(`S3 bucket created: ${bucketName}`);
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
    console.log(`Bucket policy set for ${bucketName}`);
};

const uploadBuildDirectoryToBucket = async (bucketName, buildPath) => {
    const s3UploadCommand = `aws s3 cp ${buildPath} s3://${bucketName} --recursive --metadata-directive REPLACE --cache-control max-age=31536000,public --exclude "*.map" --exclude "service-worker.js" --exclude "robots.txt" --include "*.html" --include "*.css" --acl public-read --content-encoding identity --storage-class REDUCED_REDUNDANCY`;
    await promisify(exec)(s3UploadCommand);
};

const appDescription = process.argv[2] || 'App to manage a todo list';
callAPI(appDescription);
  
const deleteFolderRecursive = async (path) => {
    try {
        exec(`rm -rf ${path}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
        console.error(`Error deleting ${path}:`, error);
    }
};