// Copyright (c) 2020 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import React, {useEffect} from 'react';
import Amplify, {Hub} from 'aws-amplify';
import awsconfig from '../../aws-exports';
import {AmplifyAuthenticator, AmplifySignUp} from '@aws-amplify/ui-react';

Amplify.configure(awsconfig);
export const AWS_LOGIN_URL = 'aws/aws-login';
export const AWS_WEB_CLIENT_ID = awsconfig && awsconfig.aws_cognito_identity_pool_id;

const AwsLogin = () => {

  const [accepted, setAccepted] = React.useState(false)

  useEffect(() => {
    Hub.listen('auth', data => {
      const {payload} = data;
      if (payload.event === 'signIn') {
        window.opener.postMessage({success: true}, location.origin);
      }
    });
  }, []);

  return <div>
      <b>Data Privacy</b><br></br>
        <input type="checkbox" id="accepted" name="accepted" onChange={e => setAccepted(e.target.checked)} />
        <label for="accepted">Please read and accept the Data Privacy Regulations regarding the use of your personal data. Read especially section 'Contact Form'. In short: We use the data soley to process your contact request. After the request has been answered and there is no data storage purpose anymore your data is deleted. The data is not used for any other purpose. The data is not passed to any third party. https://legal.comsysto.com/comsystoreply.de/de/datenschutz/</label>
        <hr></hr>
<AmplifyAuthenticator usernameAlias="email">
    <AmplifySignUp
        slot="sign-up"
        usernameAlias="email"
        formFields={[
          {
            type: "email",
            label: "Email",
            placeholder: "your email",
            required: true,
          },
          {
            type: "password",
            label: "Password",
            placeholder: "secure password",
            required: true,
          },
          {
            type: "custom:firstname",
            label: "Firstname",
            placeholder: "your firstname",
            required: false,
          },
          {
            type: "custom:lastname",
            label: "Lastname",
            placeholder: "your lastname",
            required: false,
          },
          {
            type: "custom:company",
            label: "Company",
            placeholder: "your company",
            required: false,
          },
          {
            type: "custom:marketing_confirm",
            label: "Data Privacy Regulations accepted",
            placeholder: "please confirm at top",
            required: true,
            value: accepted ? "yes" : "no"
          }
        ]} 
      />
    </AmplifyAuthenticator>
    </div>;
};

export default AwsLogin;
