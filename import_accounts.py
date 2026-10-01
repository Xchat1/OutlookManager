#!/usr/bin/env python3
"""
导入账号脚本
从提供的文本格式导入邮箱账号到数据库
"""

import asyncio
import sys
from database import db_manager

# 要导入的账号列表 (格式: email----password)
ACCOUNTS_TO_IMPORT = """hiapnag7463@outlook.com----comgrgbv25029
uyvpzomk15321@outlook.com----nxauzgt4077
sbzjwef897@outlook.com----dbamjdw8150
hfabrt28651@outlook.com----kqzbwdmz454
oldcig8864@outlook.com----btmrugu1022
ivlfri0268@outlook.com----jbvakbh04806
vprbazbg280@outlook.com----xrocwmtk4060
nppppiia1660@outlook.com----nejpb69910"""

async def import_accounts():
    """导入账号到数据库"""
    print("开始导入账号...")
    
    added_count = 0
    updated_count = 0
    skipped_count = 0
    error_count = 0
    
    lines = ACCOUNTS_TO_IMPORT.strip().split('\n')
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        
        try:
            parts = line.split('----')
            if len(parts) >= 2:
                email = parts[0].strip()
                password = parts[1].strip()
                
                # 检查账号是否存在
                exists = await db_manager.account_exists(email)
                
                if exists:
                    # 更新现有账号
                    success = await db_manager.update_account(email, password=password, refresh_token='')
                    if success:
                        updated_count += 1
                        print(f"✓ 更新账号: {email}")
                    else:
                        error_count += 1
                        print(f"✗ 更新账号失败: {email}")
                else:
                    # 添加新账号
                    success = await db_manager.add_account(
                        email=email,
                        password=password,
                        client_id='dbc8e03a-b00c-46bd-ae65-b683e7707cb0',
                        refresh_token=''
                    )
                    if success:
                        added_count += 1
                        print(f"✓ 添加账号: {email}")
                    else:
                        skipped_count += 1
                        print(f"⊘ 跳过账号 (可能已存在): {email}")
            else:
                error_count += 1
                print(f"✗ 格式错误: {line}")
        except Exception as e:
            error_count += 1
            print(f"✗ 处理失败: {line}, 错误: {e}")
    
    print(f"\n导入完成!")
    print(f"  新增: {added_count}")
    print(f"  更新: {updated_count}")
    print(f"  跳过: {skipped_count}")
    print(f"  错误: {error_count}")
    print(f"  总计: {len(lines)}")

if __name__ == "__main__":
    asyncio.run(import_accounts())
