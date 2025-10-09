#!/usr/bin/env python3
"""
IMAP邮件客户端模块
处理IMAP连接和邮件获取操作
"""

import asyncio
import imaplib
import email
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional
from email.header import decode_header
from email import utils as email_utils
from fastapi import HTTPException

from config import IMAP_SERVER, IMAP_PORT, INBOX_FOLDER_NAME
from auth import get_access_token

logger = logging.getLogger(__name__)

# ============================================================================
# 辅助函数
# ============================================================================

def decode_header_value(header_value):
    """解码邮件头部信息"""
    if header_value is None: 
        return ""
    decoded_string = ""
    try:
        parts = decode_header(str(header_value))
        for part, charset in parts:
            if isinstance(part, bytes):
                try: 
                    decoded_string += part.decode(charset if charset else 'utf-8', 'replace')
                except LookupError: 
                    decoded_string += part.decode('utf-8', 'replace')
            else: 
                decoded_string += str(part)
    except Exception:
        if isinstance(header_value, str): 
            return header_value
        try: 
            return str(header_value, 'utf-8', 'replace') if isinstance(header_value, bytes) else str(header_value)
        except: 
            return "[Header Decode Error]"
    return decoded_string

# ============================================================================
# IMAP客户端类
# ============================================================================

class IMAPEmailClient:
    """IMAP邮件客户端（按需连接模式）"""
    
    def __init__(self, email: str, account_info: Dict):
        """初始化IMAP邮件客户端
        
        Args:
            email: 邮箱地址
            account_info: 包含refresh_token的账户信息
        """
        self.email = email
        self.refresh_token = account_info['refresh_token']
        self.access_token = ''
        self.expires_at = 0
        
        # Token管理锁
        self._token_lock = asyncio.Lock()
        
        logger.debug(f"IMAPEmailClient初始化 ({email})，采用按需连接策略")
    
    def is_token_expired(self) -> bool:
        """检查access token是否过期或即将过期"""
        buffer_time = 300  # 5分钟缓冲时间
        return datetime.now().timestamp() + buffer_time >= self.expires_at
    
    async def ensure_token_valid(self):
        """确保token有效（异步版本，带并发控制）"""
        async with self._token_lock:
            if not self.access_token or self.is_token_expired():
                logger.info(f"{self.email} access token已过期或不存在，需要刷新")
                await self.refresh_access_token()
    
    async def refresh_access_token(self) -> None:
        """刷新访问令牌"""
        try:
            logger.info(f"🔑 正在刷新 {self.email} 的访问令牌...")
            access_token = await get_access_token(self.refresh_token)
            
            if access_token:
                self.access_token = access_token
                self.expires_at = time.time() + 3600  # 默认1小时过期
                expires_at_str = datetime.fromtimestamp(self.expires_at).strftime('%Y-%m-%d %H:%M:%S')
                logger.info(f"✓ Token刷新成功（有效期至: {expires_at_str}）")
            else:
                raise HTTPException(status_code=401, detail="Failed to refresh access token")
                
        except Exception as e:
            logger.error(f"✗ Token刷新失败 {self.email}: {e}")
            raise
    
    async def create_imap_connection(self, mailbox_to_select=INBOX_FOLDER_NAME):
        """创建IMAP连接（按需创建，带超时和重试）"""
        await self.ensure_token_valid()
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    logger.info(f"🔄 重试连接 IMAP (第{attempt+1}次)")
                
                def _sync_connect():
                    imap_conn = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
                    auth_string = f"user={self.email}\1auth=Bearer {self.access_token}\1\1"
                    typ, data = imap_conn.authenticate('XOAUTH2', lambda x: auth_string.encode('utf-8'))
                    
                    if typ == 'OK':
                        stat_select, data_select = imap_conn.select(mailbox_to_select, readonly=True)
                        if stat_select == 'OK':
                            return imap_conn
                        else:
                            error_msg = data_select[0].decode('utf-8', 'replace') if data_select and data_select[0] else "未知错误"
                            raise Exception(f"选择邮箱 '{mailbox_to_select}' 失败: {error_msg}")
                    else:
                        error_message = data[0].decode('utf-8', 'replace') if data and data[0] else "未知认证错误"
                        raise Exception(f"IMAP XOAUTH2 认证失败: {error_message} (Type: {typ})")
                
                # 在线程池中执行，带10秒超时
                imap_conn = await asyncio.wait_for(
                    asyncio.to_thread(_sync_connect), timeout=10.0
                )
                logger.info(f"🔌 IMAP连接已建立 → {mailbox_to_select}")
                return imap_conn
                
            except asyncio.TimeoutError:
                logger.error(f"创建IMAP连接超时 ({self.email}), 第{attempt+1}次尝试")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)
                    continue
            except Exception as e:
                logger.error(f"创建IMAP连接失败 ({self.email}), 第{attempt+1}次尝试: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)
                    continue
        
        logger.error(f"经过{max_retries}次尝试，仍无法创建IMAP连接 ({self.email})")
        raise HTTPException(status_code=500, detail=f"Failed to connect to IMAP server for {self.email}")
    
    def close_imap_connection(self, imap_conn):
        """安全关闭IMAP连接"""
        if imap_conn:
            try:
                current_state = getattr(imap_conn, 'state', None)
                
                try:
                    if current_state == 'SELECTED':
                        imap_conn.close()
                except Exception as e:
                    logger.debug(f"关闭邮箱时出现预期错误: {e}")
                
                try:
                    if current_state != 'LOGOUT':
                        imap_conn.logout()
                except Exception as e:
                    logger.debug(f"登出时出现预期错误: {e}")
                
                logger.info(f"🔌 IMAP连接已关闭")
            except Exception as e:
                logger.debug(f"关闭IMAP连接时发生预期错误: {e}")

    async def get_messages_with_content(self, folder_id: str = INBOX_FOLDER_NAME, top: int = 5) -> List[Dict]:
        """获取指定文件夹的邮件（一次性获取完整内容，包括正文）
        
        优化点：
        - 一次性获取邮件的完整内容（头部+正文）
        - 前端可以缓存这些数据，查看详情时无需再次请求
        
        Args:
            folder_id: 文件夹ID, 默认为'INBOX'
            top: 获取的邮件数量
        """
        import time
        start_time = time.time()
        logger.info(f"📧 开始获取 {self.email} 的邮件（文件夹: {folder_id}, 请求数量: {top}）")
        
        imap_conn = None
        try:
            imap_conn = await self.create_imap_connection(folder_id)
            
            def _sync_get_messages_full():
                # 快速扫描邮件UID列表（毫秒级操作）
                scan_start = time.time()
                typ, uid_data = imap_conn.uid('search', None, "ALL")
                if typ != 'OK':
                    raise Exception(f"在 '{folder_id}' 中搜索邮件失败 (status: {typ})。")
                
                if not uid_data[0]:
                    return []
                
                uids = uid_data[0].split()
                scan_time = (time.time() - scan_start) * 1000
                logger.info(f"📋 扫描完成: 共 {len(uids)} 封邮件 (耗时: {scan_time:.0f}ms)")
                
                # 只获取最新的top条邮件
                uids = uids[-top:] if len(uids) > top else uids
                uids.reverse()  # 最新的在前
                
                fetch_start = time.time()
                logger.info(f"📥 开始获取 {len(uids)} 封邮件的完整内容（包含正文和附件）...")
                
                messages = []
                for idx, uid_bytes in enumerate(uids, 1):
                    try:
                        # 一次性获取完整邮件内容（RFC822）
                        typ, msg_data = imap_conn.uid('fetch', uid_bytes, '(RFC822)')
                        
                        if typ == 'OK' and msg_data and msg_data[0] is not None:
                            raw_email_bytes = None
                            if isinstance(msg_data[0], tuple) and len(msg_data[0]) == 2:
                                raw_email_bytes = msg_data[0][1]
                            
                            if raw_email_bytes:
                                email_message = email.message_from_bytes(raw_email_bytes)
                                
                                # 解析头部信息
                                subject = decode_header_value(email_message['Subject']) or "(No Subject)"
                                from_str = decode_header_value(email_message['From']) or "(Unknown Sender)"
                                to_str = decode_header_value(email_message['To']) or ""
                                date_str = email_message['Date'] or "(Unknown Date)"
                                
                                # 解析From字段
                                from_name = "(Unknown)"
                                from_email = ""
                                if '<' in from_str and '>' in from_str:
                                    from_name = from_str.split('<')[0].strip().strip('"')
                                    from_email = from_str.split('<')[1].split('>')[0].strip()
                                else:
                                    from_email = from_str.strip()
                                    if '@' in from_email:
                                        from_name = from_email.split('@')[0]
                                
                                # 解析日期
                                try:
                                    dt_obj = email_utils.parsedate_to_datetime(date_str)
                                    if dt_obj:
                                        date_str = dt_obj.strftime('%Y-%m-%d %H:%M:%S')
                                except Exception:
                                    date_str = date_str[:25] if len(date_str) > 25 else date_str
                                
                                # 解析邮件正文（优先HTML）
                                body_content = ""
                                body_type = "text"
                                body_preview = ""
                                
                                if email_message.is_multipart():
                                    html_content = None
                                    text_content = None
                                    
                                    for part in email_message.walk():
                                        content_type = part.get_content_type()
                                        content_disposition = str(part.get("Content-Disposition"))
                                        
                                        if 'attachment' not in content_disposition.lower():
                                            try:
                                                charset = part.get_content_charset() or 'utf-8'
                                                payload = part.get_payload(decode=True)
                                                
                                                if content_type == 'text/html' and not html_content:
                                                    html_content = payload.decode(charset, errors='replace')
                                                elif content_type == 'text/plain' and not text_content:
                                                    text_content = payload.decode(charset, errors='replace')
                                            except Exception:
                                                continue
                                    
                                    # 优先使用HTML内容
                                    if html_content:
                                        body_content = html_content
                                        body_type = "html"
                                        # 生成预览文本（移除HTML标签）
                                        import re
                                        body_preview = re.sub('<[^<]+?>', '', html_content)[:150]
                                    elif text_content:
                                        body_content = text_content
                                        body_type = "text"
                                        body_preview = text_content[:150]
                                    else:
                                        body_content = "[未找到可读的邮件内容]"
                                        body_preview = "[未找到可读的邮件内容]"
                                else:
                                    # 非多部分邮件
                                    try:
                                        charset = email_message.get_content_charset() or 'utf-8'
                                        payload = email_message.get_payload(decode=True)
                                        body_content = payload.decode(charset, errors='replace')
                                        
                                        # 检查是否为HTML内容
                                        if '<html' in body_content.lower() or '<body' in body_content.lower():
                                            body_type = "html"
                                            import re
                                            body_preview = re.sub('<[^<]+?>', '', body_content)[:150]
                                        else:
                                            body_preview = body_content[:150]
                                    except Exception:
                                        body_content = "[Failed to decode email body]"
                                        body_preview = "[Failed to decode email body]"
                                
                                if not body_content:
                                    body_content = "[未找到可读的文本内容]"
                                    body_preview = "[未找到可读的文本内容]"
                                
                                # 构建完整邮件信息（包含正文）
                                message = {
                                    'id': uid_bytes.decode('utf-8'),
                                    'subject': subject,
                                    'receivedDateTime': date_str,
                                    'sender': {
                                        'emailAddress': {
                                            'address': from_email,
                                            'name': from_name
                                        }
                                    },
                                    'from': {
                                        'emailAddress': {
                                            'address': from_email,
                                            'name': from_name
                                        }
                                    },
                                    'toRecipients': [{'emailAddress': {'address': to_str, 'name': to_str}}] if to_str else [],
                                    'body': {
                                        'content': body_content,
                                        'contentType': body_type
                                    },
                                    'bodyPreview': body_preview
                                }
                                messages.append(message)
                                
                    except Exception as e:
                        logger.error(f"  ✗ 处理邮件UID {uid_bytes}时出错: {e}")
                        continue
                
                fetch_time = (time.time() - fetch_start) * 1000
                logger.info(f"📬 内容获取完成: {len(messages)} 封邮件 (耗时: {fetch_time:.0f}ms, 平均: {fetch_time/len(messages) if messages else 0:.0f}ms/封)")
                
                return messages
            
            # 在线程池中执行同步IMAP操作
            messages = await asyncio.to_thread(_sync_get_messages_full)
            
            total_time = (time.time() - start_time) * 1000
            logger.info(f"✅ 完成！总耗时: {total_time:.0f}ms | 获取 {len(messages)} 封完整邮件（已包含正文，前端可缓存）")
            return messages
            
        except asyncio.CancelledError:
            logger.warning(f"获取邮件操作被取消 ({self.email})")
            raise
        except Exception as e:
            logger.error(f"获取邮件失败 {self.email}: {e}")
            raise HTTPException(status_code=500, detail="Failed to retrieve emails")
        finally:
            if imap_conn:
                self.close_imap_connection(imap_conn)

    async def cleanup(self):
        """清理资源"""
        logger.debug(f"IMAPEmailClient清理完成 ({self.email})")

