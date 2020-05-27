# Demo App

This is the src code of kepler.gl demo app. You can copy this folder out and run it locally.

#### 1. Install

```sh
npm install
```

or

```sh
yarn
```


#### 2. Mapbox Token
add mapbox access token to node env

```sh
export MapboxAccessToken=<your_mapbox_token>
```

#### 3. Setup AWS Amplify
[Install and configure](https://docs.amplify.aws/cli/start/install) the Amplify CLI:
```sh
npm install -g @aws-amplify/cli
```
```sh
amplify configure
```

Add [Authentication](https://docs.amplify.aws/cli/auth/overview) and [Storage](https://docs.amplify.aws/lib/storage/getting-started/q/platform/js) by running:
```sh
amplify add auth
```
```sh
amplify add storage
```
If already configured:
```sh
amplify update auth
```
```sh
amplify update storage
```
Finish the setup by:
```sh
amplify push
```
Finally, set the AWSAccountName (just for display) in the environment:
```sh
export AWSAccountName=demo-account
```
Please note that URLs of shared maps expire after one hour.

#### 4. Start the app

```sh
npm start
```
