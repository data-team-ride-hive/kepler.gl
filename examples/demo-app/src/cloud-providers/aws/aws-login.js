import React, {useEffect} from 'react';
import Amplify, {Hub} from 'aws-amplify';
import awsconfig from './aws-exports';
import {AmplifyAuthenticator} from '@aws-amplify/ui-react';

Amplify.configure(awsconfig);
export const AWS_LOGIN_URL = 'aws/aws-login';

const AwsLogin = () => {
  useEffect(() => {
    Hub.listen('auth', (data) => {
      const {payload} = data;
      if (payload.event === 'signIn') {
        window.opener.postMessage({success: true}, location.origin);
      }
      if (payload.event === 'signOut') {
        console.log('A user has signed out!');
      }
    });
  }, []);

  return <AmplifyAuthenticator usernameAlias="email" />;
};

export default AwsLogin;
