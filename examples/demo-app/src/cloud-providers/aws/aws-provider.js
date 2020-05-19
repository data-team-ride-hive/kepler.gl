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

import AwsIcon from './aws-icon';
import {Provider} from 'kepler.gl/cloud-providers';
import window from 'global';
import {AWS_WEB_CLIENT_ID, awsmobile} from './aws-exports';
import 'aws-sdk';
import {Auth, Storage} from 'aws-amplify';
import {MAP_URI} from '../../constants/default-settings';
import {AWS_LOGIN_URL} from './aws-login';

export const PROVIDER_NAME = 'aws';
export const DISPLAY_NAME = 'AWS';
export const PRIVATE_STORAGE_ENABLED = true;
export const SHARING_ENABLED = true;

Storage.configure({level: 'private'});

export default class AwsProvider extends Provider {
  constructor() {
    super({name: PROVIDER_NAME, displayName: DISPLAY_NAME, icon: AwsIcon});
  }

  /**
   * Required!
   * Idea / Hack: https://github.com/amazon-archives/amazon-cognito-identity-js/issues/508
   *
   * @param onCloudLoginSuccess
   */
  async login(onCloudLoginSuccess) {
    const link = `${window.location.protocol}//${window.location.host}/${AWS_LOGIN_URL}`;
    const style = `location, toolbar, resizable, scrollbars, status, width=500, height=440, top=200, left=400`;
    const authWindow = window.open(link, 'awsCognito', style);

    const handleLogin = async (e) => {
      if (authWindow) {
        authWindow.close();
      }

      window.removeEventListener('message', handleLogin);

      if (e.data.success) {
        onCloudLoginSuccess();
      }
    };
    window.addEventListener('message', handleLogin);
  }

  /**
   * Required!
   *
   * @returns {Array<Viz>}
   */
  async listMaps() {
    let s3PrivateFiles = await this._getMapListFromStorage('private');
    let s3PublicFiles = await this._getMapListFromStorage('public');

    return [...s3PublicFiles, ...s3PrivateFiles];
  }

  async _getMapListFromStorage(level) {
    let mapList = [];
    let capitalizedLevel = level.charAt(0).toUpperCase() + level.slice(1);
    await Storage.list('', {level})
      .then((result) => {
        mapList = AwsProvider._updateFileList(result, level);
      })
      .catch((e) => {
        this._handleError(`${capitalizedLevel} map load failed`, e);
      });
    return mapList;
  }

  static async _updateFileList(fileList, level) {
    let updatedFileList = [];

    for (const file of fileList) {
      if (!file.key.endsWith('.json')) {
        continue;
      }
      const title = file.key.split('.')[0];
      const thumbnailKey = title + '.png';
      const thumbnailURL = await Storage.get(thumbnailKey, {
        level: level,
        download: false
      });

      const description = await Storage.get(thumbnailKey, {
        level: level,
        download: true
      }).then((thumbnail) =>
        thumbnail.Metadata.desc ? atob(thumbnail.Metadata.desc) : 'No description available.'
      );
      const mapIsPrivate = level === 'private';

      updatedFileList.push({
        id: file.key,
        title: title,
        description: description,
        privateMap: mapIsPrivate,
        thumbnail: thumbnailURL,
        lastModification: new Date(Date.parse(file.lastModified)),
        loadParams: {
          mapId: file.key,
          privateMap: mapIsPrivate,
          level: level
        }
      });
    }
    return updatedFileList;
  }

  /**
   * Required!
   *
   * @returns {MapResponse}
   */
  async downloadMap(loadParams) {
    const {level, mapId, identityId} = loadParams;
    let mapURL =
      level === 'private'
        ? await Storage.get(mapId, {level})
        : await Storage.get(mapId, {level, identityId});

    const mapData = await fetch(mapURL).then((response) => response.json());
    this._loadParam = loadParams;

    return {
      map: mapData,
      format: 'keplergl'
    };
  }

  async uploadMap({mapData, options = {}}) {
    const {isPublic, overwrite} = options;
    const {map, thumbnail} = mapData;
    const {title, description} = map && map.info;
    const name = title;
    // Since we share through a map link, this could be private as well
    const level = isPublic ? 'protected' : 'private';
    let mapId = '';
    let identityId = '';

    await Auth.currentUserInfo().then((userInfo) => {
      identityId = userInfo.id;
    });
    await Storage.put(name + '.png', thumbnail, {
      level,
      contentType: 'images/png',
      metadata: {desc: btoa(description)}
    }).catch((e) => {
      this._handleError('Saving failed', e);
    });

    await Storage.put(name + '.json', map, {
      level,
      contentType: 'application/json'
    })
      .then((response) => {
        mapId = response && response.key;
      })
      .catch((e) => {
        this._handleError('Saving failed', e);
      });

    // If public, url for sharing is created:
    if (isPublic) {
      let day = 60 * 60 * 24;
      await Storage.get(mapId, {download: false, level, expires: day}).then((link) => {
        this._shareUrl = encodeURIComponent(link);
      });
      return {
        shareUrl: this.getShareUrl(true)
      };

      // // With loadParams used in downloadMap, but user has to be logged in
      // this._loadParam =  {identityId, level, mapId};
      // return {shareUrl: this.getShareUrl(true)}
    }

    // if not public, map is saved and private map url is created
    this._loadParam = {...this._loadParam, level, mapId};
    return this._loadParam;
  }

  /**
   * Required!
   *
   * @param onCloudLogoutSuccess
   */
  async logout(onCloudLogoutSuccess) {
    try {
      await Auth.signOut().then(() => {
        onCloudLogoutSuccess();
      });
    } catch (e) {
      this._handleError('Signing out failed', e);
    }
  }

  /**
   * Required!
   *
   * @returns {boolean}
   */
  hasPrivateStorage() {
    return PRIVATE_STORAGE_ENABLED;
  }

  /**
   * Required!
   *
   * @returns {boolean}
   */
  hasSharingUrl() {
    return SHARING_ENABLED;
  }

  getAccessToken() {
    let token = null;
    if (window.localStorage) {
      const key = `CognitoIdentityServiceProvider.${AWS_WEB_CLIENT_ID}`;
      const lastAuthUserKey = `${key}.LastAuthUser`;
      const lastAuthUser = window.localStorage.getItem(lastAuthUserKey);
      const tokenKey = `${key}.${lastAuthUser}.accessToken`;
      token = window.localStorage.getItem(tokenKey);
    }
    return !!token;
  }

  getUserName() {
    if (window.localStorage) {
      const key = `CognitoIdentityServiceProvider.${AWS_WEB_CLIENT_ID}`;
      const lastAuthUser = window.localStorage.getItem(`${key}.LastAuthUser`);
      const userData = JSON.parse(window.localStorage.getItem(`${key}.${lastAuthUser}.userData`));
      return userData
        ? userData['UserAttributes'].find(function (item) {
            return item.Name === 'email';
          }).Value
        : '';
    }
    return null;
  }

  getAccessTokenFromLocation() {}

  getShareUrl(fullUrl = true) {
    // Shared through direct map link:
    return fullUrl
      ? `${window.location.protocol}//${window.location.host}/${MAP_URI}${this._shareUrl}`
      : `/${MAP_URI}${this._shareUrl}`;

    // // To share map thorough loadParams in url:
    // const {level, mapId, identityId} = this._loadParam;
    // const mapLink = `demo/map/${PROVIDER_NAME}?level=${level}&mapId=${mapId}&identityId=${identityId}`;
    // return fullUrl
    //     ? `${window.location.protocol}//${window.location.host}/${mapLink}`
    //     : `/${mapLink}`;
  }

  getMapUrl(fullURL = true) {
    const {level, mapId} = this._loadParam;
    const mapLink = `demo/map/${PROVIDER_NAME}?level=${level}&mapId=${mapId}`;
    return fullURL
      ? `${window.location.protocol}//${window.location.host}/${mapLink}`
      : `/${mapLink}`;
  }

  _handleError(message, error) {
    console.error(message, error);
    throw new Error(`${message}, error message: 
      ${error && error.message}`);
  }
}
