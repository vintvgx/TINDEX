from flask import Flask, jsonify 
import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
from urllib.parse import urlencode

app = Flask(__name__)

@app.route('/test') 
def print_hello_world():
    """
    Simple test endpoint that returns a "Hello World!" message.
    
    This function serves as a basic health check and testing endpoint for the API.
    It returns a JSON response with a success status and a simple greeting message.
    
    Returns:
        flask.Response: A JSON response containing:
            - success (bool): Always True, indicating successful execution
            - data (str): The string "Hello World!"
            
    Notes:
        - This endpoint is primarily used for testing API connectivity
        - No authentication or authorization required
        - No input parameters needed
        - Always returns a successful response
    """
    return jsonify({
        'success': True,
        'data': 'Hello World!'
    })

@app.route('/trending-stocks')
def get_trending_stocks():
    try:
        # FINVIZ trending stocks URL
        url = "https://finviz.com/screener.ashx?v=111&o=-volume"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=60)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Parse the data (you'll need to inspect FINVIZ structure)
        stocks = []
        table = soup.find('table', {'class': 'screener_table'})
        
        if table:
            rows = table.find_all('tr')[1:]  # Skip header
            for row in rows[:20]:  # Top 20 stocks
                cells = row.find_all('td')
                if len(cells) > 1:
                    stock_data = {
                        'ticker': cells[1].text.strip(),
                        'company': cells[2].text.strip(),
                        'price': cells[8].text.strip(),
                        'change': cells[9].text.strip(),
                        'volume': cells[10].text.strip()
                    }
                    stocks.append(stock_data)
        
        return jsonify({
            'success': True,
            'data': stocks,
            'timestamp': time.time()
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/stock/<ticker>')
def get_stock_data(ticker):
    try:
        url = f"https://finviz.com/quote.ashx?t={ticker.upper()}&p=d"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=60)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Extract stock data from the page
        stock_data = {
            'ticker': ticker.upper(),
            'price': None,
            'change': None,
            'market_cap': None
        }
        
        # Parse specific elements (inspect FINVIZ for exact selectors)
        price_element = soup.find('td', {'class': 'snapshot-td2'})
        if price_element:
            stock_data['price'] = price_element.text.strip()
            
        return jsonify({
            'success': True,
            'data': stock_data
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True)