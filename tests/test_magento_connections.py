#!/usr/bin/env python3
"""
Magento Database Connection Test Script

This script tests connectivity to all three Magento MySQL databases (UK, FR, NL)
and reports timing, connectivity issues, and potential causes.
"""

import sys
import os
import time
import socket

# Add parent directory to path so we can import backend modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

def test_dns_resolution(host: str) -> dict:
    """Test DNS resolution for a host"""
    result = {
        'host': host,
        'dns_resolved': False,
        'ip_address': None,
        'dns_time_ms': None,
        'error': None
    }
    
    start = time.time()
    try:
        ip = socket.gethostbyname(host)
        result['dns_resolved'] = True
        result['ip_address'] = ip
        result['dns_time_ms'] = round((time.time() - start) * 1000, 2)
    except socket.gaierror as e:
        result['error'] = str(e)
        result['dns_time_ms'] = round((time.time() - start) * 1000, 2)
    
    return result


def test_tcp_connection(host: str, port: int = 3306, timeout: int = 10) -> dict:
    """Test TCP connectivity to a host:port"""
    result = {
        'host': host,
        'port': port,
        'tcp_connected': False,
        'tcp_time_ms': None,
        'error': None
    }
    
    start = time.time()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    
    try:
        sock.connect((host, port))
        result['tcp_connected'] = True
        result['tcp_time_ms'] = round((time.time() - start) * 1000, 2)
    except socket.timeout:
        result['error'] = f"Connection timed out after {timeout}s"
        result['tcp_time_ms'] = round((time.time() - start) * 1000, 2)
    except socket.error as e:
        result['error'] = str(e)
        result['tcp_time_ms'] = round((time.time() - start) * 1000, 2)
    finally:
        sock.close()
    
    return result


def test_mysql_connection(region: str) -> dict:
    """Test full MySQL connection using pymysql"""
    result = {
        'region': region,
        'mysql_connected': False,
        'mysql_time_ms': None,
        'db_version': None,
        'test_query_time_ms': None,
        'error': None
    }
    
    try:
        import pymysql
        import pymysql.cursors
        from core.config import settings
        
        # Get connection parameters based on region
        port = settings.MAGENTO_DB_PORT
        
        if region == "uk":
            host = settings.MAGENTO_DB_HOST_UK
            user = settings.MAGENTO_DB_USER_UK
            password = settings.MAGENTO_DB_PASSWORD_UK
            db_name = settings.MAGENTO_DB_NAME_UK
        elif region == "nl":
            host = settings.MAGENTO_DB_HOST_NL
            user = settings.MAGENTO_DB_USER_NL
            password = settings.MAGENTO_DB_PASSWORD_NL
            db_name = settings.MAGENTO_DB_NAME_NL
        elif region == "fr":
            host = settings.MAGENTO_DB_HOST_FR
            user = settings.MAGENTO_DB_USER_FR
            password = settings.MAGENTO_DB_PASSWORD_FR
            db_name = settings.MAGENTO_DB_NAME_FR
        else:
            result['error'] = f"Invalid region: {region}"
            return result
        
        result['host'] = host
        result['database'] = db_name
        
        if not user or not password:
            result['error'] = f"Credentials not configured for region {region}"
            return result
        
        # Attempt connection with timeout
        start = time.time()
        conn = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=db_name,
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=30,
            read_timeout=30,
            write_timeout=30
        )
        result['mysql_connected'] = True
        result['mysql_time_ms'] = round((time.time() - start) * 1000, 2)
        
        # Get server version
        with conn.cursor() as cursor:
            cursor.execute("SELECT VERSION() as version")
            version = cursor.fetchone()
            result['db_version'] = version['version'] if version else None
        
        # Test a simple query
        query_start = time.time()
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 as test")
            cursor.fetchone()
        result['test_query_time_ms'] = round((time.time() - query_start) * 1000, 2)
        
        conn.close()
        
    except ImportError as e:
        result['error'] = f"Missing dependency: {e}"
    except Exception as e:
        result['error'] = str(e)
        result['mysql_time_ms'] = round((time.time() - start) * 1000, 2) if 'start' in locals() else None
    
    return result


def print_result(title: str, result: dict):
    """Pretty print a result dictionary"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")
    for key, value in result.items():
        status = ""
        if key.endswith('_connected') or key.endswith('_resolved'):
            status = "✅" if value else "❌"
        elif key == 'error' and value:
            status = "⚠️ "
        print(f"  {key:25s}: {status} {value}")


def main():
    print("\n" + "="*60)
    print("  🔍 MAGENTO DATABASE CONNECTION DIAGNOSTICS")
    print("="*60)
    print(f"  Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Test running from: {socket.gethostname()}")
    print("="*60)
    
    # Define the hosts to test
    hosts = {
        'UK': 'rm365uk.hypernode.io',
        'FR': 'rm365fr.hypernode.io',
        'NL': 'rm365nl.hypernode.io'
    }
    
    all_results = {}
    
    for region, host in hosts.items():
        print(f"\n\n{'#'*60}")
        print(f"  TESTING {region} REGION: {host}")
        print(f"{'#'*60}")
        
        # Step 1: DNS Resolution
        dns_result = test_dns_resolution(host)
        print_result(f"DNS Resolution ({region})", dns_result)
        
        # Step 2: TCP Connection (only if DNS resolved)
        if dns_result['dns_resolved']:
            tcp_result = test_tcp_connection(host, 3306, timeout=15)
            print_result(f"TCP Connection ({region})", tcp_result)
        else:
            tcp_result = {'tcp_connected': False, 'error': 'Skipped - DNS failed'}
            print_result(f"TCP Connection ({region})", tcp_result)
        
        # Step 3: MySQL Connection (only if TCP connected)
        if tcp_result.get('tcp_connected'):
            mysql_result = test_mysql_connection(region.lower())
            print_result(f"MySQL Connection ({region})", mysql_result)
        else:
            mysql_result = {'mysql_connected': False, 'error': 'Skipped - TCP failed'}
            print_result(f"MySQL Connection ({region})", mysql_result)
        
        all_results[region] = {
            'dns': dns_result,
            'tcp': tcp_result,
            'mysql': mysql_result
        }
    
    # Summary
    print("\n\n" + "="*60)
    print("  📊 SUMMARY")
    print("="*60)
    
    for region, results in all_results.items():
        dns_ok = "✅" if results['dns']['dns_resolved'] else "❌"
        tcp_ok = "✅" if results['tcp'].get('tcp_connected') else "❌"
        mysql_ok = "✅" if results['mysql'].get('mysql_connected') else "❌"
        
        dns_time = results['dns'].get('dns_time_ms', 'N/A')
        tcp_time = results['tcp'].get('tcp_time_ms', 'N/A')
        mysql_time = results['mysql'].get('mysql_time_ms', 'N/A')
        
        print(f"\n  {region}:")
        print(f"    DNS:   {dns_ok} ({dns_time}ms)")
        print(f"    TCP:   {tcp_ok} ({tcp_time}ms)")
        print(f"    MySQL: {mysql_ok} ({mysql_time}ms)")
    
    # Recommendations
    print("\n\n" + "="*60)
    print("  💡 RECOMMENDATIONS")
    print("="*60)
    
    issues_found = False
    
    for region, results in all_results.items():
        if not results['dns']['dns_resolved']:
            issues_found = True
            print(f"\n  ⚠️  {region}: DNS resolution failed")
            print("     → Check your network connection")
            print("     → Verify the hostname is correct")
            print("     → Try using a different DNS server")
        
        elif not results['tcp'].get('tcp_connected'):
            issues_found = True
            print(f"\n  ⚠️  {region}: TCP connection failed")
            print("     → Port 3306 may be blocked by firewall")
            print("     → The database server may be down")
            print("     → Your IP may not be whitelisted")
            print("     → Try: nc -zv {host} 3306".format(host=hosts[region]))
        
        elif not results['mysql'].get('mysql_connected'):
            issues_found = True
            error = results['mysql'].get('error', 'Unknown error')
            print(f"\n  ⚠️  {region}: MySQL connection failed")
            print(f"     → Error: {error}")
            print("     → Check MAGENTO_DB_USER_{region} and MAGENTO_DB_PASSWORD_{region} env vars")
            print("     → Verify the database credentials are correct")
            print("     → The user may not have access from your IP")
    
    if not issues_found:
        print("\n  ✅ All connections are working properly!")
    
    # Timing analysis
    print("\n\n" + "="*60)
    print("  ⏱️  TIMING ANALYSIS")
    print("="*60)
    
    for region, results in all_results.items():
        total_time = 0
        if results['dns'].get('dns_time_ms'):
            total_time += results['dns']['dns_time_ms']
        if results['tcp'].get('tcp_time_ms'):
            total_time += results['tcp']['tcp_time_ms']
        if results['mysql'].get('mysql_time_ms'):
            total_time += results['mysql']['mysql_time_ms']
        
        print(f"\n  {region} Total connection time: {total_time}ms")
        
        if total_time > 5000:
            print(f"    ⚠️  Connection is VERY SLOW (>5s)")
            print("    → Consider using connection pooling")
            print("    → Check network latency to the server")
            print("    → Database server may be under heavy load")
        elif total_time > 2000:
            print(f"    ⚠️  Connection is SLOW (>2s)")
            print("    → Network latency may be an issue")
        elif total_time > 0:
            print(f"    ✅ Connection speed is acceptable")
    
    print("\n")
    return 0 if not issues_found else 1


if __name__ == "__main__":
    sys.exit(main())
