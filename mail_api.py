#!/usr/bin/env python3
"""
Microsoft邮件管理API
基于FastAPI的现代化异步实现
重构版本：使用模块化架构
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError

# 导入自定义模块
from database import db_manager
from models import (
    ApiResponse, ImportAccountData, ImportResult, AdminTokenRequest,
    DeleteAccountRequest, TempAccountRequest, SystemConfigRequest,
    AccountTagRequest, TestEmailRequest
)
from config import CLIENT_ID, ADMIN_TOKEN, DEFAULT_EMAIL_LIMIT, logger
from imap_client import IMAPEmailClient

# ============================================================================
# 辅助函数
# ============================================================================

def verify_admin_token(token: str) -> bool:
    """验证管理令牌"""
    return token == ADMIN_TOKEN

def get_admin_token(authorization: Optional[str] = Header(None)) -> str:
    """获取并验证管理令牌"""
    if not authorization:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="无效的认证格式")
    
    token = authorization[7:]  # 移除 "Bearer " 前缀
    
    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="无效的管理令牌")
    
    return token

async def load_accounts_config() -> Dict[str, Dict[str, str]]:
    """从数据库加载批量账户信息"""
    try:
        accounts = await db_manager.get_all_accounts()
        
        # 如果数据库为空，尝试从config.txt迁移
        if not accounts:
            logger.info("数据库中没有账户，尝试从config.txt迁移...")
            added_count, error_count = await db_manager.migrate_from_config_file()
            if added_count > 0:
                logger.info(f"成功从config.txt迁移了 {added_count} 个账户")
                accounts = await db_manager.get_all_accounts()
            else:
                logger.info("没有找到config.txt或迁移失败")
        
        return accounts
        
    except Exception as e:
        logger.error(f"加载账户配置失败: {e}")
        return {}

async def save_accounts_config(accounts: Dict[str, Dict[str, str]]) -> bool:
    """保存账户信息到配置文件（异步版本）"""
    def _sync_save():
        try:
            header_lines = []
            if Path('config.txt').exists():
                with open('config.txt', 'r', encoding='utf-8') as f:
                    for line in f:
                        stripped = line.strip()
                        if stripped.startswith('#') or not stripped:
                            header_lines.append(line.rstrip())
                        else:
                            break
            
            if not header_lines:
                header_lines = [
                    '# 批量邮箱账户配置文件',
                    '# 格式：用户名----密码----client_id----refresh_token',
                    '# 每行一个账户，用----分隔各字段',
                    ''
                ]
            
            with open('config.txt', 'w', encoding='utf-8') as f:
                for line in header_lines:
                    f.write(line + '\n')
                
                for email, info in accounts.items():
                    password = info.get('password', '')
                    refresh_token = info.get('refresh_token', '')
                    line = f"{email}----{password}----{CLIENT_ID}----{refresh_token}"
                    f.write(line + '\n')
            
            return True
        except Exception as e:
            logger.error(f"保存配置文件失败: {e}")
            return False
    
    return await asyncio.to_thread(_sync_save)

# ============================================================================
# 系统配置管理
# ============================================================================

async def load_system_config() -> Dict[str, any]:
    """加载系统配置（使用数据库）"""
    try:
        email_limit = await db_manager.get_system_config('email_limit', str(DEFAULT_EMAIL_LIMIT))
        return {
            'email_limit': int(email_limit) if email_limit else DEFAULT_EMAIL_LIMIT
        }
    except Exception as e:
        logger.error(f"加载系统配置失败: {e}")
        return {'email_limit': DEFAULT_EMAIL_LIMIT}

async def save_system_config(config: Dict[str, any]) -> bool:
    """保存系统配置（使用数据库）"""
    try:
        for key, value in config.items():
            await db_manager.set_system_config(key, str(value))
        return True
    except Exception as e:
        logger.error(f"保存系统配置失败: {e}")
        return False

async def get_system_config_value(key: str, default_value: any = None) -> any:
    """获取系统配置值（使用数据库）"""
    try:
        value = await db_manager.get_system_config(key, str(default_value) if default_value is not None else None)
        if key == 'email_limit' and value:
            return int(value)
        return value
    except Exception as e:
        logger.error(f"获取系统配置失败: {e}")
        return default_value

async def set_system_config_value(key: str, value: any) -> bool:
    """设置系统配置值（使用数据库）"""
    try:
        return await db_manager.set_system_config(key, str(value))
    except Exception as e:
        logger.error(f"设置系统配置失败: {e}")
        return False

async def merge_accounts_data(existing_accounts: Dict[str, Dict[str, str]], 
                             new_accounts: List[ImportAccountData], 
                             merge_mode: str = "update") -> ImportResult:
    """合并账户数据"""
    result = ImportResult(
        success=True,
        total_count=len(new_accounts),
        added_count=0,
        updated_count=0,
        skipped_count=0,
        error_count=0,
        details=[],
        message=""
    )
    
    if merge_mode == "replace":
        existing_accounts.clear()
        result.details.append({"action": "clear", "message": "清空现有账户数据"})
    
    for account_data in new_accounts:
        try:
            email = account_data.email
            new_info = {
                'password': account_data.password or '',
                'refresh_token': account_data.refresh_token
            }
            
            if email in existing_accounts:
                if merge_mode == "skip":
                    result.skipped_count += 1
                    result.details.append({
                        "email": email, 
                        "action": "skipped", 
                        "message": "账户已存在，跳过更新"
                    })
                else:
                    existing_accounts[email] = new_info
                    result.updated_count += 1
                    result.details.append({
                        "email": email, 
                        "action": "updated", 
                        "message": "更新账户信息"
                    })
            else:
                existing_accounts[email] = new_info
                result.added_count += 1
                result.details.append({
                    "email": email, 
                    "action": "added", 
                    "message": "新增账户"
                })
                
        except Exception as e:
            result.error_count += 1
            result.details.append({
                "email": getattr(account_data, 'email', 'unknown'), 
                "action": "error", 
                "message": f"处理失败: {str(e)}"
            })
            logger.error(f"处理账户数据失败: {e}")
    
    # 生成结果消息
    if result.error_count > 0:
        result.success = False
        result.message = f"导入完成，但有 {result.error_count} 个错误"
    else:
        result.message = f"导入成功：新增 {result.added_count} 个，更新 {result.updated_count} 个，跳过 {result.skipped_count} 个"
    
    return result

# ============================================================================
# 邮件管理器
# ============================================================================

class EmailManager:
    """邮件管理器，负责管理多个邮箱账户"""
    
    def __init__(self):
        self.clients = {}
        self._accounts = None
        self._clients_lock = None
        
    async def _load_accounts(self):
        """加载账户配置（懒加载）"""
        if self._accounts is None:
            self._accounts = await load_accounts_config()
        return self._accounts
        
    async def get_client(self, email: str) -> Optional[IMAPEmailClient]:
        """获取指定邮箱的客户端（带并发控制）"""
        if self._clients_lock is None:
            self._clients_lock = asyncio.Lock()
            
        async with self._clients_lock:
            accounts = await load_accounts_config()
            if email not in accounts:
                return None
                
            if email not in self.clients:
                self.clients[email] = IMAPEmailClient(email, accounts[email])
                
            return self.clients[email]
    
    async def verify_email(self, email: str) -> bool:
        """验证邮箱是否存在于配置中"""
        accounts = await load_accounts_config()
        return email in accounts
    
    async def get_messages(self, email: str, top: int = 5) -> List[Dict]:
        """获取指定邮箱的邮件列表（包含完整内容）"""
        client = await self.get_client(email)
        if not client:
            raise HTTPException(status_code=404, detail=f"邮箱 {email} 未在配置中找到")
        
        try:
            # 使用优化后的方法：一次性获取完整邮件内容
            return await client.get_messages_with_content(top=top)
        except HTTPException as e:
            if "refresh token" in e.detail.lower() or "token" in e.detail.lower():
                raise HTTPException(
                    status_code=401, 
                    detail=f"邮箱 {email} 的 Refresh Token 已过期。请使用 get_refresh_token.py 重新获取授权，然后更新 config.txt 中的 refresh_token。"
                )
            raise
    
    async def cleanup_all(self):
        """清理所有资源"""
        try:
            if self._clients_lock:
                async with self._clients_lock:
                    for email, client in self.clients.items():
                        try:
                            logger.info(f"清理客户端: {email}")
                            await client.cleanup()
                        except Exception as e:
                            logger.error(f"清理客户端失败 ({email}): {e}")
                    
                    self.clients.clear()
                    logger.info("所有客户端已清理完毕")
                
        except Exception as e:
            logger.error(f"清理资源时出错: {e}")

# ============================================================================
# FastAPI应用和API端点
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用程序生命周期管理"""
    logger.info("启动邮件管理系统...")
    logger.info("初始化数据库...")
    yield
    logger.info("正在关闭邮件管理系统...")
    try:
        await email_manager.cleanup_all()
        db_manager.close()
    except Exception as e:
        logger.error(f"清理系统资源时出错: {e}")
    logger.info("邮件管理系统已关闭")

app = FastAPI(
    title="Outlook邮件管理系统",
    description="基于FastAPI的现代化异步邮件管理服务（重构版）",
    version="2.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 添加验证错误处理器
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"Pydantic验证错误: {exc}")
    logger.error(f"请求路径: {request.url}")
    logger.error(f"请求方法: {request.method}")
    try:
        body = await request.body()
        logger.error(f"请求数据: {body.decode('utf-8')}")
    except:
        logger.error("无法读取请求数据")
    
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "message": "数据验证失败"}
    )

# 挂载静态文件服务
app.mount("/static", StaticFiles(directory="static"), name="static")

# 创建邮件管理器实例
email_manager = EmailManager()

# ============================================================================
# 前端页面路由
# ============================================================================

@app.get("/")
async def root():
    """根路径 - 返回简化版前端页面"""
    return FileResponse("static/index_simple.html")


@app.get("/style.css")
async def style_css():
    """CSS文件 - 带缓存控制"""
    response = FileResponse("static/style.css")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/script_simple.js")
async def script_simple_js():
    """简化版JavaScript文件 - 带缓存控制"""
    response = FileResponse("static/script_simple.js")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.get("/admin")
async def admin_page():
    """管理页面"""
    return FileResponse("static/admin.html")

@app.get("/admin.js")
async def admin_js():
    """管理页面JavaScript文件 - 带缓存控制"""
    response = FileResponse("static/admin.js")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ============================================================================
# 邮件API端点
# ============================================================================

@app.get("/api/messages")
async def get_messages(email: str, top: int = None) -> ApiResponse:
    """获取邮件列表（包含完整内容）
    
    优化：一次性返回邮件的完整信息，前端可以缓存
    """
    email = email.strip()
    
    if not email:
        return ApiResponse(success=False, message="请提供邮箱地址")
    
    # 如果没有指定top参数，使用系统配置的默认值
    if top is None:
        top = await get_system_config_value('email_limit', DEFAULT_EMAIL_LIMIT)
    
    try:
        # 使用优化后的get_messages，返回完整邮件内容
        messages = await email_manager.get_messages(email, top)
        return ApiResponse(success=True, data=messages)
    except HTTPException as e:
        return ApiResponse(success=False, message=e.detail)
    except Exception as e:
        logger.error(f"获取邮件列表失败: {e}")
        return ApiResponse(success=False, message="获取邮件列表失败")

# 注意：现在前端应该使用缓存的数据，不再需要单独的message detail端点
# 但为了兼容性保留（如果前端直接访问）
@app.get("/api/message/{message_id}")
async def get_message_detail(message_id: str, email: str) -> ApiResponse:
    """获取邮件详情（兼容性保留，建议前端使用缓存）"""
    return ApiResponse(
        success=False, 
        message="请使用 /api/messages 接口获取邮件列表，包含完整内容"
    )

@app.post("/api/temp-messages")
async def get_temp_messages(request: TempAccountRequest) -> ApiResponse:
    """使用临时账户获取邮件列表（包含完整内容）"""
    try:
        account_info = {
            'password': request.password,
            'refresh_token': request.refresh_token
        }
        
        temp_client = IMAPEmailClient(request.email, account_info)
        
        try:
            # 使用优化后的方法获取完整邮件
            messages = await temp_client.get_messages_with_content(top=request.top)
            return ApiResponse(success=True, data=messages)
        finally:
            await temp_client.cleanup()
                
    except HTTPException as e:
        return ApiResponse(success=False, message=e.detail)
    except Exception as e:
        logger.error(f"临时账户获取邮件失败: {e}")
        return ApiResponse(success=False, message=f"获取邮件失败: {str(e)}")

@app.get("/api/accounts")
async def get_accounts(authorization: Optional[str] = Header(None)) -> ApiResponse:
    """获取所有账户列表（可选管理认证）"""
    try:
        is_admin = False
        if authorization and authorization.startswith("Bearer "):
            token = authorization[7:]
            is_admin = verify_admin_token(token)
        
        accounts = await load_accounts_config()
        account_list = [{"email": email} for email in accounts.keys()]
        return ApiResponse(success=True, data=account_list, message=f"共 {len(account_list)} 个账户")
    except Exception as e:
        logger.error(f"获取账户列表失败: {e}")
        return ApiResponse(success=False, message="获取账户列表失败")

# ============================================================================
# 账户导入/导出API端点
# ============================================================================

@app.post("/api/import")
async def import_accounts_dict(request_data: dict) -> dict:
    """批量导入邮箱账户"""
    try:
        logger.info(f"完整请求数据: {request_data}")
        
        accounts_data = request_data.get('accounts', [])
        merge_mode = request_data.get('merge_mode', 'update')
        
        logger.info(f"收到导入请求，账户数量: {len(accounts_data) if isinstance(accounts_data, (list, dict)) else 'N/A'}, 合并模式: {merge_mode}")
        
        # 检查并处理嵌套的accounts字段
        if isinstance(accounts_data, dict):
            if 'accounts' in accounts_data:
                logger.info("发现嵌套的accounts字段，正在提取...")
                accounts_data = accounts_data['accounts']
            else:
                return {
                    "success": False,
                    "total_count": 0,
                    "added_count": 0,
                    "updated_count": 0,
                    "skipped_count": 0,
                    "error_count": 0,
                    "details": [{"action": "error", "message": "账户数据格式错误：应该是数组"}],
                    "message": "账户数据格式错误：应该是数组"
                }
        
        if not isinstance(accounts_data, list):
            return {
                "success": False,
                "total_count": 0,
                "added_count": 0,
                "updated_count": 0,
                "skipped_count": 0,
                "error_count": 1,
                "details": [{"action": "error", "message": f"账户数据类型错误: {type(accounts_data)}, 应该是数组"}],
                "message": f"账户数据类型错误: {type(accounts_data)}, 应该是数组"
            }
        
        # 转换为 ImportAccountData 对象
        accounts = []
        for i, acc_data in enumerate(accounts_data):
            try:
                if isinstance(acc_data, str):
                    logger.error(f"账户数据是字符串而不是字典: {acc_data}")
                    continue
                
                account = ImportAccountData(
                    email=acc_data.get('email', ''),
                    password=acc_data.get('password', ''),
                    client_id=acc_data.get('client_id', ''),
                    refresh_token=acc_data.get('refresh_token', '')
                )
                accounts.append(account)
            except Exception as e:
                logger.error(f"转换账户数据失败: {acc_data}, 错误: {e}")
                continue
        
        # 加载现有账户并合并
        existing_accounts = await load_accounts_config()
        result = await merge_accounts_data(existing_accounts, accounts, merge_mode)
        
        # 保存更新后的数据
        if result.success and (result.added_count > 0 or result.updated_count > 0):
            save_success = await save_accounts_config(existing_accounts)
            if not save_success:
                result.success = False
                result.message += "，但保存文件失败"
        
        return {
            "success": result.success,
            "total_count": result.total_count,
            "added_count": result.added_count,
            "updated_count": result.updated_count,
            "skipped_count": result.skipped_count,
            "error_count": result.error_count,
            "details": result.details,
            "message": result.message
        }
        
    except Exception as e:
        logger.error(f"导入账户失败: {e}")
        return {
            "success": False,
            "total_count": len(request_data.get('accounts', [])),
            "added_count": 0,
            "updated_count": 0,
            "skipped_count": 0,
            "error_count": len(request_data.get('accounts', [])),
            "details": [{"action": "error", "message": f"系统错误: {str(e)}"}],
            "message": f"导入失败: {str(e)}"
        }

@app.post("/api/parse-import-text")
async def parse_import_text(request: dict) -> ApiResponse:
    """解析导入文本格式数据"""
    try:
        import_text = request.get('text', '').strip()
        if not import_text:
            return ApiResponse(success=False, message="请提供要导入的文本数据")
        
        accounts = []
        errors = []
        
        lines = import_text.split('\n')
        for line_num, line in enumerate(lines, 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
                
            try:
                parts = line.split('----')
                if len(parts) >= 4:
                    email, password, client_id, refresh_token = parts[0], parts[1], parts[2], parts[3]
                    accounts.append({
                        "email": email.strip(),
                        "password": password.strip(),
                        "client_id": client_id.strip(),
                        "refresh_token": refresh_token.strip()
                    })
                elif len(parts) == 2:
                    email, refresh_token = parts
                    accounts.append({
                        "email": email.strip(),
                        "password": "",
                        "client_id": CLIENT_ID,
                        "refresh_token": refresh_token.strip()
                    })
                else:
                    errors.append(f"第{line_num}行格式错误：{line}")
            except Exception as e:
                errors.append(f"第{line_num}行解析失败：{str(e)}")
        
        result_data = {
            "accounts": accounts,
            "parsed_count": len(accounts),
            "error_count": len(errors),
            "errors": errors
        }
        
        if errors:
            return ApiResponse(
                success=True, 
                data=result_data, 
                message=f"解析完成：成功 {len(accounts)} 条，错误 {len(errors)} 条"
            )
        else:
            return ApiResponse(
                success=True, 
                data=result_data, 
                message=f"解析成功：共 {len(accounts)} 条账户数据"
            )
            
    except Exception as e:
        logger.error(f"解析导入文本失败: {e}")
        return ApiResponse(success=False, message=f"解析失败: {str(e)}")

@app.get("/api/export")
async def export_accounts_public(format: str = "txt"):
    """公开导出账户配置"""
    try:
        accounts = await load_accounts_config()
        
        if not accounts:
            raise HTTPException(status_code=404, detail="暂无账户数据")
        
        export_lines = []
        export_lines.append("# Outlook邮件系统账号配置文件")
        export_lines.append(f"# 导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        export_lines.append("# 格式: 邮箱----密码----client_id----refresh_token")
        export_lines.append("# 注意：请妥善保管此文件，包含敏感信息")
        export_lines.append("")
        
        for email, account_info in accounts.items():
            password = account_info.get('password', '')
            refresh_token = account_info.get('refresh_token', '')
            client_id = account_info.get('client_id', CLIENT_ID)
            line = f"{email}----{password}----{client_id}----{refresh_token}"
            export_lines.append(line)
        
        export_content = "\n".join(export_lines)
        filename = f"outlook_accounts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        
        return PlainTextResponse(
            content=export_content,
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Content-Type": "text/plain; charset=utf-8"
            }
        )
        
    except Exception as e:
        logger.error(f"导出账户配置失败: {e}")
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")

# ============================================================================
# 系统配置API端点
# ============================================================================

@app.get("/api/system/config")
async def get_system_config() -> ApiResponse:
    """获取系统配置"""
    try:
        config = await load_system_config()
        return ApiResponse(success=True, data=config)
    except Exception as e:
        logger.error(f"获取系统配置失败: {e}")
        return ApiResponse(success=False, message="获取系统配置失败")

@app.post("/api/system/config")
async def update_system_config(request: SystemConfigRequest) -> ApiResponse:
    """更新系统配置"""
    try:
        if request.email_limit < 1 or request.email_limit > 50:
            return ApiResponse(success=False, message="邮件限制必须在1-50之间")
        
        success = await set_system_config_value('email_limit', request.email_limit)
        if success:
            return ApiResponse(success=True, message=f"系统配置更新成功，邮件限制设置为 {request.email_limit}")
        else:
            return ApiResponse(success=False, message="保存系统配置失败")
    except Exception as e:
        logger.error(f"更新系统配置失败: {e}")
        return ApiResponse(success=False, message="更新系统配置失败")

# ============================================================================
# 测试邮件API端点
# ============================================================================

@app.post("/api/test-email")
async def test_email_connection(request: dict) -> ApiResponse:
    """测试邮件连接，获取最新的1条邮件"""
    try:
        email = request.get('email', '').strip()
        if not email:
            return ApiResponse(success=False, message="请提供邮箱地址")
        
        if 'refresh_token' in request:
            # 临时账户测试
            account_info = {
                'password': request.get('password', ''),
                'refresh_token': request.get('refresh_token', '')
            }
            
            temp_client = IMAPEmailClient(email, account_info)
            try:
                messages = await temp_client.get_messages_with_content(top=1)
                if messages:
                    latest_message = messages[0]
                    return ApiResponse(
                        success=True, 
                        data=latest_message,
                        message="测试成功，获取到最新邮件"
                    )
                else:
                    return ApiResponse(
                        success=True, 
                        data=None,
                        message="测试成功，但该邮箱暂无邮件"
                    )
            finally:
                await temp_client.cleanup()
        else:
            # 配置文件中的账户测试
            messages = await email_manager.get_messages(email, 1)
            if messages:
                latest_message = messages[0]
                return ApiResponse(
                    success=True, 
                    data=latest_message,
                    message="测试成功，获取到最新邮件"
                )
            else:
                return ApiResponse(
                    success=True, 
                    data=None,
                    message="测试成功，但该邮箱暂无邮件"
                )
                
    except HTTPException as e:
        return ApiResponse(success=False, message=e.detail)
    except Exception as e:
        logger.error(f"测试邮件连接失败: {e}")
        return ApiResponse(success=False, message=f"测试失败: {str(e)}")

# ============================================================================
# 命令行入口
# ============================================================================

async def main():
    """命令行模式入口"""
    try:
        accounts = await load_accounts_config()
        if not accounts:
            print("没有找到有效的邮箱配置，请检查config.txt文件")
            return
            
        print(f"已加载 {len(accounts)} 个邮箱账户")
        for email in accounts.keys():
            print(f"- {email}")
            
        # 测试第一个账户
        first_email = list(accounts.keys())[0]
        manager = EmailManager()
        
        print(f"\n测试获取 {first_email} 的邮件...")
        messages = await manager.get_messages(first_email, 5)
        
        print(f"\n找到 {len(messages)} 封邮件:")
        for i, msg in enumerate(messages, 1):
            subject = msg.get('subject', '无主题')
            from_addr = msg.get('from', {}).get('emailAddress', {}).get('address', '未知发件人')
            print(f"{i}. {subject} - {from_addr}")
            
    except Exception as e:
        logger.error(f"程序执行出错: {e}")
        raise

if __name__ == '__main__':
    import sys
    import uvicorn
    
    if len(sys.argv) > 1 and sys.argv[1] == 'web':
        # Web模式
        print("启动Web服务器...")
        print("访问 http://localhost:5001 查看前端界面")
        uvicorn.run(app, host="0.0.0.0", port=5001, log_level="info")
    else:
        # 命令行模式
        asyncio.run(main())

