#!/usr/bin/env python3
"""
SQLite数据库管理模块
用于管理邮件和标签数据
"""

import sqlite3
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from pathlib import Path
import asyncio
import threading

logger = logging.getLogger(__name__)

class DatabaseManager:
    """数据库管理器"""
    
    def __init__(self, db_path: str = "outlook_manager.db"):
        self.db_path = db_path
        self._local = threading.local()
        self.init_database()
    
    def get_connection(self) -> sqlite3.Connection:
        """获取线程本地的数据库连接"""
        if not hasattr(self._local, 'connection'):
            self._local.connection = sqlite3.connect(self.db_path)
            self._local.connection.row_factory = sqlite3.Row
        return self._local.connection
    
    def init_database(self):
        """初始化数据库表"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # 创建账户表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS accounts (
                email TEXT PRIMARY KEY,
                password TEXT DEFAULT '',
                client_id TEXT DEFAULT '',
                refresh_token TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # 创建账户标签表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS account_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                tags TEXT NOT NULL,  -- JSON格式存储标签数组
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # 创建邮件缓存表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS email_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                message_id TEXT NOT NULL,
                subject TEXT,
                sender TEXT,
                received_date TEXT,
                body_preview TEXT,
                body_content TEXT,
                body_type TEXT DEFAULT 'text',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(email, message_id)
            )
        ''')
        
        # 创建系统配置表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # 创建索引
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_account_tags_email ON account_tags(email)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_email_cache_email ON email_cache(email)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_email_cache_message_id ON email_cache(message_id)')
        
        conn.commit()
        logger.info("数据库初始化完成")
    
    async def get_account_tags(self, email: str) -> List[str]:
        """获取账户标签"""
        def _sync_get():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT tags FROM account_tags WHERE email = ?', (email,))
            row = cursor.fetchone()
            if row:
                try:
                    return json.loads(row['tags'])
                except json.JSONDecodeError:
                    return []
            return []
        
        return await asyncio.to_thread(_sync_get)
    
    async def set_account_tags(self, email: str, tags: List[str]) -> bool:
        """设置账户标签"""
        def _sync_set():
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                tags_json = json.dumps(tags, ensure_ascii=False)
                
                # 先检查记录是否存在
                cursor.execute('SELECT id FROM account_tags WHERE email = ?', (email,))
                existing_record = cursor.fetchone()
                
                if existing_record:
                    # 更新现有记录
                    cursor.execute('''
                        UPDATE account_tags 
                        SET tags = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE email = ?
                    ''', (tags_json, email))
                    logger.info(f"更新账户 {email} 的标签: {tags}")
                else:
                    # 插入新记录
                    cursor.execute('''
                        INSERT INTO account_tags (email, tags, created_at, updated_at) 
                        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ''', (email, tags_json))
                    logger.info(f"为账户 {email} 创建新标签: {tags}")
                
                conn.commit()
                logger.info(f"成功保存账户 {email} 的标签")
                return True
            except Exception as e:
                logger.error(f"设置账户标签失败: {e}")
                conn.rollback()
                return False
        
        return await asyncio.to_thread(_sync_set)
    
    async def get_all_tags(self) -> List[str]:
        """获取所有标签"""
        def _sync_get():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT tags FROM account_tags')
            rows = cursor.fetchall()
            
            all_tags = set()
            for row in rows:
                try:
                    tags = json.loads(row['tags'])
                    all_tags.update(tags)
                except json.JSONDecodeError:
                    continue
            
            return sorted(list(all_tags))
        
        return await asyncio.to_thread(_sync_get)
    
    async def get_accounts_with_tags(self) -> Dict[str, List[str]]:
        """获取所有账户及其标签"""
        def _sync_get():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT email, tags FROM account_tags')
            rows = cursor.fetchall()
            
            result = {}
            for row in rows:
                try:
                    tags = json.loads(row['tags'])
                    result[row['email']] = tags
                except json.JSONDecodeError:
                    result[row['email']] = []
            
            return result
        
        return await asyncio.to_thread(_sync_get)
    
    async def cache_email(self, email: str, message_id: str, email_data: Dict) -> bool:
        """缓存邮件数据"""
        def _sync_cache():
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                
                # 提取邮件信息
                subject = email_data.get('subject', '')
                sender_info = email_data.get('sender', {}).get('emailAddress', {})
                sender = f"{sender_info.get('name', '')} <{sender_info.get('address', '')}>"
                received_date = email_data.get('receivedDateTime', '')
                body_preview = email_data.get('bodyPreview', '')
                body_info = email_data.get('body', {})
                body_content = body_info.get('content', '')
                body_type = body_info.get('contentType', 'text')
                
                cursor.execute('''
                    INSERT OR REPLACE INTO email_cache 
                    (email, message_id, subject, sender, received_date, body_preview, body_content, body_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (email, message_id, subject, sender, received_date, body_preview, body_content, body_type))
                
                conn.commit()
                return True
            except Exception as e:
                logger.error(f"缓存邮件失败: {e}")
                return False
        
        return await asyncio.to_thread(_sync_cache)
    
    async def get_cached_email(self, email: str, message_id: str) -> Optional[Dict]:
        """获取缓存的邮件数据"""
        def _sync_get():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM email_cache 
                WHERE email = ? AND message_id = ?
            ''', (email, message_id))
            row = cursor.fetchone()
            
            if row:
                return {
                    'id': row['message_id'],
                    'subject': row['subject'],
                    'sender': {'emailAddress': {'name': row['sender'].split(' <')[0] if ' <' in row['sender'] else row['sender'],
                                               'address': row['sender'].split('<')[1].rstrip('>') if '<' in row['sender'] else row['sender']}},
                    'receivedDateTime': row['received_date'],
                    'bodyPreview': row['body_preview'],
                    'body': {'content': row['body_content'], 'contentType': row['body_type']}
                }
            return None
        
        return await asyncio.to_thread(_sync_get)
    
    async def get_system_config(self, key: str, default_value: str = None) -> Optional[str]:
        """获取系统配置"""
        def _sync_get():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT value FROM system_config WHERE key = ?', (key,))
            row = cursor.fetchone()
            return row['value'] if row else default_value
        
        return await asyncio.to_thread(_sync_get)
    
    async def set_system_config(self, key: str, value: str) -> bool:
        """设置系统配置"""
        def _sync_set():
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT OR REPLACE INTO system_config (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                ''', (key, value))
                conn.commit()
                return True
            except Exception as e:
                logger.error(f"设置系统配置失败: {e}")
                return False
        
        return await asyncio.to_thread(_sync_set)
    
    async def cleanup_old_emails(self, days: int = 30) -> int:
        """清理旧的邮件缓存"""
        def _sync_cleanup():
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('''
                    DELETE FROM email_cache 
                    WHERE created_at < datetime('now', '-{} days')
                '''.format(days))
                deleted_count = cursor.rowcount
                conn.commit()
                return deleted_count
            except Exception as e:
                logger.error(f"清理旧邮件失败: {e}")
                return 0
        
        return await asyncio.to_thread(_sync_cleanup)
    
    async def get_all_accounts(self) -> Dict[str, Dict[str, str]]:
        """获取所有账户"""
        def _sync_get():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT email, password, client_id, refresh_token FROM accounts')
            rows = cursor.fetchall()
            
            result = {}
            for row in rows:
                result[row['email']] = {
                    'password': row['password'] or '',
                    'client_id': row['client_id'] or '',
                    'refresh_token': row['refresh_token']
                }
            return result
        
        return await asyncio.to_thread(_sync_get)
    
    async def add_account(self, email: str, password: str = '', client_id: str = '', refresh_token: str = '') -> bool:
        """添加账户"""
        def _sync_add():
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO accounts (email, password, client_id, refresh_token)
                    VALUES (?, ?, ?, ?)
                ''', (email, password, client_id, refresh_token))
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                # 账户已存在
                return False
            except Exception as e:
                logger.error(f"添加账户失败: {e}")
                return False
        
        return await asyncio.to_thread(_sync_add)
    
    async def update_account(self, email: str, password: str = None, client_id: str = None, refresh_token: str = None) -> bool:
        """更新账户"""
        def _sync_update():
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                
                # 构建更新语句
                updates = []
                params = []
                
                if password is not None:
                    updates.append('password = ?')
                    params.append(password)
                
                if client_id is not None:
                    updates.append('client_id = ?')
                    params.append(client_id)
                
                if refresh_token is not None:
                    updates.append('refresh_token = ?')
                    params.append(refresh_token)
                
                if not updates:
                    return True  # 没有更新内容
                
                updates.append('updated_at = CURRENT_TIMESTAMP')
                params.append(email)
                
                sql = f"UPDATE accounts SET {', '.join(updates)} WHERE email = ?"
                cursor.execute(sql, params)
                conn.commit()
                return cursor.rowcount > 0
            except Exception as e:
                logger.error(f"更新账户失败: {e}")
                return False
        
        return await asyncio.to_thread(_sync_update)
    
    async def delete_account(self, email: str) -> bool:
        """删除账户"""
        def _sync_delete():
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                
                # 删除账户
                cursor.execute('DELETE FROM accounts WHERE email = ?', (email,))
                
                # 同时删除相关的标签
                cursor.execute('DELETE FROM account_tags WHERE email = ?', (email,))
                
                # 删除相关的邮件缓存
                cursor.execute('DELETE FROM email_cache WHERE email = ?', (email,))
                
                conn.commit()
                return cursor.rowcount > 0
            except Exception as e:
                logger.error(f"删除账户失败: {e}")
                return False
        
        return await asyncio.to_thread(_sync_delete)
    
    async def account_exists(self, email: str) -> bool:
        """检查账户是否存在"""
        def _sync_check():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT 1 FROM accounts WHERE email = ?', (email,))
            return cursor.fetchone() is not None
        
        return await asyncio.to_thread(_sync_check)
    
    async def get_account(self, email: str) -> Optional[Dict[str, str]]:
        """获取单个账户信息"""
        def _sync_get():
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT password, client_id, refresh_token FROM accounts WHERE email = ?', (email,))
            row = cursor.fetchone()
            
            if row:
                return {
                    'password': row['password'] or '',
                    'client_id': row['client_id'] or '',
                    'refresh_token': row['refresh_token']
                }
            return None
        
        return await asyncio.to_thread(_sync_get)
    
    async def migrate_from_config_file(self, config_file_path: str = 'config.txt') -> Tuple[int, int]:
        """从config.txt迁移数据到数据库"""
        def _sync_migrate():
            try:
                import os
                if not os.path.exists(config_file_path):
                    return 0, 0
                
                conn = self.get_connection()
                cursor = conn.cursor()
                
                added_count = 0
                error_count = 0
                
                with open(config_file_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                
                for line in lines:
                    line = line.strip()
                    if line.startswith('#') or not line:
                        continue
                    
                    try:
                        parts = line.split('----')
                        if len(parts) >= 4:
                            email, password, client_id, refresh_token = parts[0], parts[1], parts[2], parts[3]
                            
                            # 检查账户是否已存在
                            cursor.execute('SELECT 1 FROM accounts WHERE email = ?', (email.strip(),))
                            if not cursor.fetchone():
                                cursor.execute('''
                                    INSERT INTO accounts (email, password, client_id, refresh_token)
                                    VALUES (?, ?, ?, ?)
                                ''', (email.strip(), password.strip(), client_id.strip(), refresh_token.strip()))
                                added_count += 1
                        elif len(parts) == 2:  # 兼容旧格式
                            email, refresh_token = parts
                            cursor.execute('SELECT 1 FROM accounts WHERE email = ?', (email.strip(),))
                            if not cursor.fetchone():
                                cursor.execute('''
                                    INSERT INTO accounts (email, password, client_id, refresh_token)
                                    VALUES (?, ?, ?, ?)
                                ''', (email.strip(), '', '', refresh_token.strip()))
                                added_count += 1
                    except Exception as e:
                        logger.error(f"迁移行失败: {line}, 错误: {e}")
                        error_count += 1
                
                conn.commit()
                return added_count, error_count
                
            except Exception as e:
                logger.error(f"迁移配置文件失败: {e}")
                return 0, 1
        
        return await asyncio.to_thread(_sync_migrate)
    
    def close(self):
        """关闭数据库连接"""
        if hasattr(self._local, 'connection'):
            self._local.connection.close()
            delattr(self._local, 'connection')

# 全局数据库管理器实例
db_manager = DatabaseManager()