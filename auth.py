#!/usr/bin/env python3
"""
OAuth2认证模块
处理Microsoft OAuth2令牌获取和刷新
"""

import requests
import logging
from typing import Optional
from fastapi import HTTPException

from config import CLIENT_ID, TOKEN_URL

logger = logging.getLogger(__name__)

# ============================================================================
# OAuth2令牌获取函数
# ============================================================================

async def get_access_token(refresh_token: str, check_only: bool = False) -> Optional[str]:
    """使用refresh_token获取access_token
    
    Args:
        refresh_token: 刷新令牌
        check_only: 如果为True，验证失败时返回None而不是抛出异常
        
    Returns:
        成功返回access_token，如果check_only=True且验证失败则返回None
    """
    data = {
        'client_id': CLIENT_ID,
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
        'scope': 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access'
    }
    
    try:
        # 使用requests而不是httpx，因为exp.py验证有效
        response = requests.post(TOKEN_URL, data=data)
        response.raise_for_status()
        
        token_data = response.json()
        access_token = token_data.get('access_token')
        
        if not access_token:
            error_msg = f"获取 access_token 失败: {token_data.get('error_description', '响应中未找到 access_token')}"
            logger.error(error_msg)
            if check_only:
                return None
            raise HTTPException(status_code=401, detail=error_msg)
        
        new_refresh_token = token_data.get('refresh_token')
        if new_refresh_token and new_refresh_token != refresh_token:
            logger.debug("提示: refresh_token 已被服务器更新")
        
        return access_token
    
    except requests.exceptions.HTTPError as http_err:
        logger.error(f"请求 access_token 时发生HTTP错误: {http_err}")
        if http_err.response is not None:
            logger.error(f"服务器响应: {http_err.response.status_code} - {http_err.response.text}")
        
        if check_only:
            return None
        raise HTTPException(status_code=401, detail="Refresh token已过期或无效，需要重新获取授权")
    
    except requests.exceptions.RequestException as e:
        logger.error(f"请求 access_token 时发生网络错误: {e}")
        if check_only:
            return None
        raise HTTPException(status_code=500, detail="Token acquisition failed")
    
    except Exception as e:
        logger.error(f"解析 access_token 响应时出错: {e}")
        if check_only:
            return None
        raise HTTPException(status_code=500, detail="Token acquisition failed")

